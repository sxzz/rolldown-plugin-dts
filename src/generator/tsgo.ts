import path from 'node:path'
import process from 'node:process'
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
import type { API, Project, Snapshot } from 'typescript-next/async'
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
  /** Reports type errors of emitted files. */
  typecheck?: boolean
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
  private rootFileProjects = new Map<string, string>()
  private emitQueue: Promise<void> = Promise.resolve()
  // Emitted TS file name -> original file name, for error messages.
  private emittedFiles = new Map<string, string>()
  // Config file name (or TS file name of an inferred project) -> the TS file
  // name to look up an inferred project with.
  private checkedProjects = new Map<string, string | undefined>()

  constructor(options: TsgoGeneratorOptions) {
    this.options = options
  }

  async init(): Promise<void> {
    this.pendingFiles.clear()
    this.openedFiles.clear()
    this.loadedSourceFiles.clear()
    this.projectFiles = undefined
    this.emitQueue = Promise.resolve()
    this.emittedFiles.clear()
    this.checkedProjects.clear()

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
    this.indexProjectRoots()

    // Referenced projects are not opened automatically. Their sources are
    // external-library files in this program and must be emitted by their owner.
    const seen = new Set([this.api.getCanonicalFileName(tsconfig)])
    let configs = [tsconfig]
    while (configs.length) {
      configs = configs
        .flatMap(
          (config) =>
            this.snapshot!.getConfiguredProject(config)?.parsedCommandLine
              .projectReferences ?? [],
        )
        .map(({ path: ref }) =>
          ref.endsWith('.json') ? ref : path.join(ref, 'tsconfig.json'),
        )
        .filter((config) => {
          const key = this.api!.getCanonicalFileName(config)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
      if (configs.length) {
        await this.replaceSnapshot(
          await this.snapshot.update({ openProjects: configs }),
        )
      }
    }

    if (this.options.typecheck) this.assertNoCheckDisabled()

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
          throw new Error(this.formatDiagnostics(diagnostics))
        }
      }
    }
  }

  // A tsconfig `noCheck` would hide the errors `typecheck` asks for.
  private assertNoCheckDisabled(): void {
    const configs = this.snapshot!.getProjects()
      .filter(
        ({ configFileName, parsedCommandLine }) =>
          configFileName && parsedCommandLine.options.noCheck,
      )
      .map(({ configFileName }) => configFileName)
    if (configs.length) {
      throw new Error(
        `The \`typecheck\` option conflicts with \`noCheck\` in ${configs.join(', ')}. Remove \`noCheck\` from the tsconfig or disable \`typecheck\`.`,
      )
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

  /** Type-checks every project that emitted a declaration, as a whole. */
  async check(): Promise<string | undefined> {
    await this.emitQueue
    if (!this.apiModule || !this.api || !this.snapshot) {
      throw new Error('TsgoGenerator has not been initialized.')
    }
    const snapshot = this.snapshot

    const projects = new Map<string, Project>()
    await Promise.all(
      Array.from(this.checkedProjects, async ([config, inferredFile]) => {
        const project = inferredFile
          ? await snapshot.getDefaultProjectForFile(inferredFile)
          : snapshot.getConfiguredProject(config)
        if (project) projects.set(project.id, project)
      }),
    )
    debug('type checking %d projects', projects.size)

    // Requests issued in the same tick are sent as one `batchRequests` call.
    const diagnostics = (
      await Promise.all(
        Array.from(projects.values(), ({ program }) => [
          program.getConfigFileParsingDiagnostics(),
          program.getProgramDiagnostics(),
          program.getGlobalDiagnostics(),
          program.getSyntacticDiagnostics(),
          program.getSemanticDiagnostics(),
          // Errors such as TS2742 that make the emitted declarations wrong.
          program.getDeclarationDiagnostics(),
        ]).flat(),
      )
    )
      .flat()
      .filter(
        ({ category }) => category === this.apiModule!.DiagnosticCategory.Error,
      )
    if (!diagnostics.length) return

    let error = this.formatDiagnostics(diagnostics)
    for (const [tsFileName, fileName] of this.emittedFiles) {
      error = mapError(error, tsFileName, fileName)
    }
    return error
  }

  async dispose(): Promise<void> {
    await this.emitQueue
    await this.api?.close()
    this.api = this.snapshot = this.projectFiles = undefined
  }

  private get displayName(): string {
    return this.options.compiler === 'tsrs' ? 'tsrs' : 'TypeScript Go'
  }

  private formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
    const format = process.stderr.hasColors?.()
      ? this.apiModule!.formatDiagnosticsWithColorAndContext
      : this.apiModule!.formatDiagnostics
    return format(diagnostics, this.api!)
  }

  private toTsFilename(fileName: string): string {
    return path.resolve(this.options.languageContext.toTsFilename(fileName))
  }

  private async replaceSnapshot(nextSnapshot: Snapshot): Promise<void> {
    const oldSnapshot = this.snapshot!
    this.snapshot = nextSnapshot
    this.projectFiles = undefined
    if (oldSnapshot === nextSnapshot) return
    this.indexProjectRoots()
    await oldSnapshot.dispose()
  }

  private indexProjectRoots(): void {
    this.rootFileProjects.clear()
    const requested = this.snapshot!.getConfiguredProject(this.options.tsconfig)
    for (const project of this.snapshot!.getProjects()) {
      if (!project.configFileName) continue
      for (const fileName of project.parsedCommandLine.fileNames) {
        const key = this.api!.getCanonicalFileName(path.resolve(fileName))
        if (!this.rootFileProjects.has(key) || project.id === requested?.id) {
          this.rootFileProjects.set(key, project.configFileName)
        }
      }
    }
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
    await this.replaceSnapshot(nextSnapshot)
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
    const canonicalFileName = this.api.getCanonicalFileName(tsFileName)
    const ownerConfig = this.rootFileProjects.get(canonicalFileName)
    const project = ownerConfig
      ? this.snapshot.getConfiguredProject(ownerConfig)
      : configuredProject && fileNames?.has(canonicalFileName)
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

    if (this.options.typecheck) {
      this.emittedFiles.set(tsFileName, fileName)
      // Projects are looked up again in the final snapshot by `check`.
      this.checkedProjects.set(
        project.configFileName || tsFileName,
        project.configFileName ? undefined : tsFileName,
      )
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
          this.formatDiagnostics(output.diagnostics),
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
