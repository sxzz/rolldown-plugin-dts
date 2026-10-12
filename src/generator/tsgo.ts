import path from 'node:path'
import { createDebug } from 'obug'
import { loadTsgoApi } from '../tsgo.ts'
import type { LanguageContext } from '../custom-language.ts'
import type { Generator, GeneratorResult } from './index.ts'
import type { SourceMapInput } from 'rolldown'
import type * as TsgoApiModule from 'typescript-next/async'
import type { API, Snapshot } from 'typescript-next/async'

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
  private apiModule?: typeof TsgoApiModule
  private api?: API
  private snapshot?: Snapshot
  private pendingFiles = new Map<string, string>()
  private openedFiles = new Set<string>()
  private emitQueue: Promise<void> = Promise.resolve()

  constructor(options: TsgoGeneratorOptions) {
    this.options = options
  }

  async init(): Promise<void> {
    this.pendingFiles.clear()
    this.openedFiles.clear()
    this.emitQueue = Promise.resolve()

    this.apiModule = loadTsgoApi(this.options.moduleUrl)
    const { tsgoPath, cwd, tsconfig } = this.options
    this.api = new this.apiModule.API({
      cwd,
      tsserverPath: tsgoPath,
    })
    this.snapshot = await this.api.createSnapshot({
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

    const openFiles = entries
      .map(([fileName]) => fileName)
      .filter((fileName) => !this.openedFiles.has(fileName))

    let nextSnapshot: Snapshot
    try {
      nextSnapshot = await this.snapshot.update({
        fileSystem: { kind: 'layer', files: Object.fromEntries(entries) },
        // Filesystem layers mark projects dirty; rebuild them before emitting.
        ensurePrograms: true,
        ...(openFiles.length ? { openFiles } : undefined),
      })
    } catch (error) {
      for (const [fileName, code] of entries) {
        if (!this.pendingFiles.has(fileName)) {
          this.pendingFiles.set(fileName, code)
        }
      }
      throw error
    }

    for (const fileName of openFiles) this.openedFiles.add(fileName)
    const oldSnapshot = this.snapshot
    this.snapshot = nextSnapshot
    if (oldSnapshot !== nextSnapshot) await oldSnapshot.dispose()
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
