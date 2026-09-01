import { existsSync } from 'node:fs'
import path from 'node:path'
import { createDebug } from 'obug'
import { loadTsgoApi, type TsgoApiModule } from '../tsgo.ts'
import type { LanguageContext } from '../custom-language.ts'
import type { Generator, GeneratorResult } from './index.ts'
import type { SourceMapInput } from 'rolldown'
import type { API, Snapshot } from 'typescript-next/unstable/async'
import type { FileSystem } from 'typescript-next/unstable/fs'

const debug = createDebug('rolldown-plugin-dts:tsgo')

export interface TsgoGeneratorOptions {
  moduleUrl?: string
  tsgoPath?: string
  cwd: string
  tsconfig: string
  vfs: boolean
  languageContext: LanguageContext
}

export class TsgoGenerator implements Generator {
  private options: TsgoGeneratorOptions
  private apiModule?: TsgoApiModule
  private api?: API
  private snapshot?: Snapshot
  private activeFiles = new Map<string, string>()
  private pendingFiles = new Map<string, string>()
  private openedFiles = new Set<string>()
  private emitQueue: Promise<void> = Promise.resolve()

  constructor(options: TsgoGeneratorOptions) {
    this.options = options
  }

  async init(): Promise<void> {
    this.activeFiles.clear()
    this.pendingFiles.clear()
    this.openedFiles.clear()
    this.emitQueue = Promise.resolve()

    this.apiModule = loadTsgoApi(this.options.moduleUrl)
    const { tsgoPath, cwd, tsconfig, vfs } = this.options
    const fs = vfs ? this.createFileSystem() : undefined
    this.api = new this.apiModule.API({
      cwd,
      tsserverPath: tsgoPath,
      fs,
    })
    this.snapshot = await this.api.updateSnapshot({
      openProjects: [tsconfig],
    })
  }

  addFile(code: string, fileName: string): void {
    if (!this.options.vfs) return
    this.pendingFiles.set(this.toTsFilename(fileName), code)
  }

  emit(code: string, fileName: string): Promise<GeneratorResult> {
    if (!this.options.vfs) {
      return this.emitFromSnapshot(fileName)
    }

    this.addFile(code, fileName)
    const result = this.emitQueue.then(async () => {
      await this.flushPendingFiles()
      return this.emitFromSnapshot(fileName)
    })
    this.emitQueue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  async dispose(): Promise<void> {
    await this.emitQueue
    await this.api?.close()
    this.api = this.snapshot = undefined
  }

  private createFileSystem(): FileSystem {
    return {
      readFile: (fileName) => this.activeFiles.get(path.resolve(fileName)),
      fileExists: (fileName) =>
        this.activeFiles.has(path.resolve(fileName)) ? true : undefined,
      directoryExists: (directoryName) =>
        this.hasVirtualDirectory(directoryName) ? true : undefined,
      realpath: (fileName) => {
        const normalized = path.resolve(fileName)
        if (
          this.activeFiles.has(normalized) ||
          this.hasVirtualDirectory(normalized)
        ) {
          return normalized
        }
      },
    }
  }

  private hasVirtualDirectory(directoryName: string): boolean {
    const normalized = path.resolve(directoryName)
    const prefix = normalized.endsWith(path.sep)
      ? normalized
      : `${normalized}${path.sep}`
    return this.activeFiles
      .keys()
      .some((fileName) => fileName.startsWith(prefix))
  }

  private toTsFilename(fileName: string): string {
    return path.resolve(this.options.languageContext.toTsFilename(fileName))
  }

  private async flushPendingFiles(): Promise<void> {
    if (!this.pendingFiles.size) return
    if (!this.api || !this.snapshot) {
      throw new Error('TsgoGenerator has not been initialized.')
    }

    const entries = [...this.pendingFiles]
    this.pendingFiles.clear()

    const previous = new Map<string, string | undefined>()
    const created: string[] = []
    const changed: string[] = []
    const openFiles: string[] = []

    for (const [fileName, code] of entries) {
      const hadVirtualFile = this.activeFiles.has(fileName)
      previous.set(fileName, this.activeFiles.get(fileName))
      this.activeFiles.set(fileName, code)

      if (hadVirtualFile || existsSync(fileName)) changed.push(fileName)
      else created.push(fileName)

      if (!this.openedFiles.has(fileName)) openFiles.push(fileName)
    }

    let nextSnapshot: Snapshot
    try {
      nextSnapshot = await this.api.updateSnapshot({
        fileChanges: {
          ...(created.length ? { created } : undefined),
          ...(changed.length ? { changed } : undefined),
        },
        ...(openFiles.length ? { openFiles } : undefined),
      })
    } catch (error) {
      for (const [fileName, code] of entries) {
        const oldCode = previous.get(fileName)
        if (oldCode === undefined) this.activeFiles.delete(fileName)
        else this.activeFiles.set(fileName, oldCode)
        if (!this.pendingFiles.has(fileName)) {
          this.pendingFiles.set(fileName, code)
        }
      }
      throw error
    }

    for (const fileName of openFiles) this.openedFiles.add(fileName)
    const oldSnapshot = this.snapshot
    this.snapshot = nextSnapshot
    await oldSnapshot.dispose()
  }

  private async emitFromSnapshot(fileName: string): Promise<GeneratorResult> {
    if (!this.apiModule || !this.api || !this.snapshot) {
      throw new Error('TsgoGenerator has not been initialized.')
    }

    const tsFileName = this.toTsFilename(fileName)
    const project = await this.snapshot
      .getDefaultProjectForFile(tsFileName)
      .catch((error: unknown) => {
        throw new Error(this.mapError(error, tsFileName, fileName), {
          cause: error,
        })
      })
    if (!project) {
      return {
        error: `No TypeScript Go project found for ${fileName}. Please check your tsconfig and custom language filename mapping.`,
      }
    }

    const output = await project.program
      .getDeclarationEmit([tsFileName])
      .catch((error: unknown) => {
        throw new Error(this.mapError(error, tsFileName, fileName), {
          cause: error,
        })
      })
    if (output.emitSkipped && output.diagnostics.length) {
      return {
        error: this.mapError(
          this.apiModule.formatDiagnostics(output.diagnostics, this.api),
          tsFileName,
          fileName,
        ),
      }
    }

    let code: string | undefined
    let map: SourceMapInput | undefined
    for (const [outputFileName, outputFile] of output.outputFiles) {
      if (
        outputFile.sourceFileName &&
        path.resolve(outputFile.sourceFileName) !== tsFileName
      ) {
        continue
      }

      if (outputFileName.endsWith('.map')) {
        map = {
          ...JSON.parse(outputFile.text),
          sources: [fileName],
        }
      } else {
        code = outputFile.text
      }
    }

    if (!code) {
      debug('[tsgo] declaration output is missing for', tsFileName)
      return {
        error: `tsgo did not generate a declaration file for ${fileName}. Please check your tsconfig.`,
      }
    }

    return { code, map }
  }

  private mapError(
    error: unknown,
    tsFileName: string,
    fileName: string,
  ): string {
    return String(error).replaceAll(tsFileName, fileName)
  }
}
