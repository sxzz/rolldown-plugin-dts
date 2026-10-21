import path from 'node:path'
import { createDebug } from 'obug'
import { RE_DTS, RE_NODE_MODULES } from '../filename.ts'
import { loadTsgoApi, loadTsgoFileSystem } from '../tsgo.ts'
import type { LanguageContext } from '../custom-language.ts'
import type { Generator, GeneratorResult } from './index.ts'
import type { SourceMapInput } from 'rolldown'
import type * as TsgoApiModule from 'typescript-next/async'
import type { API, Snapshot } from 'typescript-next/async'
import type * as TsgoFsModule from 'typescript-next/fs'

const debug = createDebug('rolldown-plugin-dts:tsgo')

export interface TsgoGeneratorOptions {
  moduleUrl?: string
  tsgoPath?: string
  runExternalCode?: boolean
  cwd: string
  tsconfig: string
  vfs: boolean
  languageContext: LanguageContext
  loadSource?: (fileName: string) => Promise<void>
}

export class TsgoGenerator implements Generator {
  private options: TsgoGeneratorOptions
  private apiModule?: typeof TsgoApiModule
  private fsModule?: typeof TsgoFsModule
  private api?: API
  private snapshot?: Snapshot
  private pendingFiles = new Map<string, string>()
  private openedFiles = new Set<string>()
  private loadedSourceFiles = new Set<string>()
  private emitQueue: Promise<void> = Promise.resolve()

  constructor(options: TsgoGeneratorOptions) {
    this.options = options
  }

  async init(): Promise<void> {
    this.pendingFiles.clear()
    this.openedFiles.clear()
    this.loadedSourceFiles.clear()
    this.emitQueue = Promise.resolve()

    this.apiModule = loadTsgoApi(this.options.moduleUrl)
    this.fsModule = this.options.vfs
      ? loadTsgoFileSystem(this.options.moduleUrl)
      : undefined
    const { tsgoPath, cwd, tsconfig } = this.options
    this.api = new this.apiModule.API({
      cwd,
      tsserverPath: tsgoPath,
      runExternalCode: this.options.runExternalCode,
    })
    this.snapshot = await this.api.createSnapshot({
      openProjects: [tsconfig],
    })
    if (!this.options.languageContext.contentMapperExtensions.length) return
    // Mapper setup and transform errors can otherwise produce empty declarations.
    const project = this.snapshot.getConfiguredProject(tsconfig)
    if (!project) return
    const diagnostics = (
      await Promise.all([
        project.program.getConfigFileParsingDiagnostics(),
        project.program.getSyntacticDiagnostics(),
      ])
    ).flat()
    if (diagnostics.length) {
      throw new Error(this.apiModule.formatDiagnostics(diagnostics, this.api))
    }
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
      await this.loadSourceFiles()
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

  private async loadSourceFiles(): Promise<void> {
    const { loadSource } = this.options
    if (!loadSource) return

    // Transforms may introduce new imports. Refresh the program until every
    // local source it discovers has been loaded through Rolldown.
    while (true) {
      const sources = new Set<string>()
      for (const project of this.snapshot!.getProjects()) {
        for (const name of await project.program.getSourceFileNames()) {
          const fileName = path.resolve(name)
          if (
            !RE_DTS.test(fileName) &&
            !RE_NODE_MODULES.test(fileName) &&
            !this.openedFiles.has(fileName) &&
            !this.loadedSourceFiles.has(fileName)
          ) {
            sources.add(fileName)
          }
        }
      }
      if (!sources.size) return
      await Promise.all(
        [...sources].map(async (fileName) => {
          await loadSource(fileName)
          this.loadedSourceFiles.add(fileName)
        }),
      )
      await this.flushPendingFiles()
    }
  }

  private async flushPendingFiles(): Promise<void> {
    if (!this.pendingFiles.size) return
    if (!this.fsModule || !this.snapshot) {
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
        fileSystem: this.fsModule.createFileSystemLayer(entries),
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

    const tsFileName = this.options.languageContext.isContentMappedFile(
      fileName,
    )
      ? path.resolve(fileName)
      : this.toTsFilename(fileName)
    let project = await this.snapshot
      .getDefaultProjectForFile(tsFileName)
      .catch((error: unknown) => {
        throw new Error(mapError(error, tsFileName, fileName), {
          cause: error,
        })
      })
    // Opening VFS files can select a nearby tsconfig instead of the requested one.
    const configuredProject = this.snapshot.getConfiguredProject(
      this.options.tsconfig,
    )
    if (configuredProject && configuredProject.id !== project?.id) {
      const fileNames = await configuredProject.program.getSourceFileNames()
      const canonicalFileName = this.api.getCanonicalFileName(tsFileName)
      if (
        fileNames.some(
          (name) =>
            this.api!.getCanonicalFileName(path.resolve(name)) ===
            canonicalFileName,
        )
      ) {
        project = configuredProject
      }
    }
    if (!project) {
      return {
        error: `No TypeScript Go project found for ${fileName}. Please check your tsconfig and custom language filename mapping.`,
      }
    }

    const output = await project.program
      .getDeclarationEmit([tsFileName])
      .catch((error: unknown) => {
        throw new Error(mapError(error, tsFileName, fileName), {
          cause: error,
        })
      })
    if (output.emitSkipped && output.diagnostics.length) {
      return {
        error: mapError(
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
}

function mapError(
  error: unknown,
  tsFileName: string,
  fileName: string,
): string {
  return String(error).replaceAll(tsFileName, fileName)
}
