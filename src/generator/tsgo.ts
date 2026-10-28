import path from 'node:path'
import { createDebug } from 'obug'
import { RE_DTS, RE_NODE_MODULES } from '../filename.ts'
import {
  loadTsgoApi,
  loadTsgoFileSystem,
  type NativeCompiler,
} from '../tsgo.ts'
import type { LanguageContext } from '../custom-language.ts'
import type { Generator, GeneratorResult } from './index.ts'
import type { SourceMapInput } from 'rolldown'
import type * as TsgoApiModule from 'typescript-next/async'
import type { API, Snapshot } from 'typescript-next/async'
import type * as TsgoFsModule from 'typescript-next/fs'
import type { Diagnostic } from 'typescript-next/proto'

const debug = createDebug('rolldown-plugin-dts:tsgo')

export interface TsgoGeneratorOptions {
  /**
   * Compiler package providing the TypeScript Go API.
   * @default 'tsgo'
   */
  compiler?: NativeCompiler
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
  private projectFiles?: Promise<Set<string>>
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
    this.projectFiles = undefined
    this.emitQueue = Promise.resolve()

    const { compiler } = this.options
    this.apiModule = loadTsgoApi(this.options.moduleUrl, undefined, compiler)
    this.fsModule = this.options.vfs
      ? loadTsgoFileSystem(this.options.moduleUrl, compiler)
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

    // eslint-disable-next-line unicorn/prefer-early-return
    if (this.options.languageContext.contentMapperExtensions.length) {
      // Mapper setup and transform errors can otherwise produce empty declarations.
      const project = this.snapshot.getConfiguredProject(tsconfig)
      if (project) {
        const diagnostics = (
          await Promise.all([
            project.program.getConfigFileParsingDiagnostics(),
            project.program.getSyntacticDiagnostics(),
          ])
        )
          .flat()
          .filter(isMapperDiagnostic)
        if (diagnostics.length) {
          throw new Error(
            this.apiModule.formatDiagnostics(diagnostics, this.api),
          )
        }
      }
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
    this.api = this.snapshot = this.projectFiles = undefined
  }

  private get displayName(): string {
    return this.options.compiler === 'tsrs' ? 'tsrs' : 'TypeScript Go'
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
        openFiles,
      })
    } catch (error) {
      for (const [fileName, code] of entries) {
        if (!this.pendingFiles.has(fileName)) {
          this.pendingFiles.set(fileName, code)
        }
      }
      throw error
    }

    for (const fileName of openFiles) {
      this.openedFiles.add(fileName)
    }
    const oldSnapshot = this.snapshot
    this.snapshot = nextSnapshot
    this.projectFiles = undefined
    if (oldSnapshot !== nextSnapshot) {
      await oldSnapshot.dispose()
    }
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
    // Opening VFS files can select a nearby tsconfig instead of the requested one.
    const configuredProject = this.snapshot.getConfiguredProject(
      this.options.tsconfig,
    )
    if (configuredProject && !this.projectFiles) {
      // Default-project lookups return the entire project config. Share this
      // promise so concurrent emits only fetch the file list once per snapshot.
      this.projectFiles = configuredProject.program
        .getSourceFileNames()
        .then(
          (fileNames) =>
            new Set(
              fileNames.map((name) =>
                this.api!.getCanonicalFileName(path.resolve(name)),
              ),
            ),
        )
        .catch((error: unknown) => {
          this.projectFiles = undefined
          throw error
        })
    }
    const fileNames = await this.projectFiles
    const project =
      configuredProject &&
      fileNames?.has(this.api.getCanonicalFileName(tsFileName))
        ? configuredProject
        : await this.snapshot
            .getDefaultProjectForFile(tsFileName)
            .catch((error: unknown) => {
              throw new Error(mapError(error, tsFileName, fileName), {
                cause: error,
              })
            })
    if (!project) {
      return {
        error: `No ${this.displayName} project found for ${fileName}. Please check your tsconfig and custom language filename mapping.`,
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
      debug(
        `[${this.options.compiler || 'tsgo'}] declaration output is missing for`,
        tsFileName,
      )
      return {
        error: `${this.options.compiler || 'tsgo'} did not generate a declaration file for ${fileName}. Please check your tsconfig.`,
      }
    }

    return { code, map }
  }
}

function isMapperDiagnostic({ source, code }: Diagnostic): boolean {
  // Mapper-authored diagnostics have a custom source. TypeScript's mapper
  // setup/transform failures use these codes (TS 7.1). Exclude TS18080, which
  // can wrap ordinary syntax errors in generated code without source mappings.
  return (
    !!source ||
    (code >= 18065 && code <= 18073) ||
    (code >= 18075 && code <= 18079) ||
    (code >= 18081 && code <= 18083) ||
    code === 18099 ||
    (code >= 18118 && code <= 18123)
  )
}

function mapError(
  error: unknown,
  tsFileName: string,
  fileName: string,
): string {
  return String(error).replaceAll(tsFileName, fileName)
}
