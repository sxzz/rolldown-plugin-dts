import path from 'node:path'
import { pathToFileURL } from 'node:url'
import Debug from 'debug'
import ts from 'typescript'
import {
  globalContext,
  type ParsedProject,
  type SourceFileToProjectMap,
  type TscContext,
} from './context.ts'
import { createFsSystem, createMemorySystem } from './system.ts'
import { customTransformers } from './transformer.ts'
import { createVueProgramFactory } from './vue.ts'
import type { TsConfigJson } from 'get-tsconfig'
import type { ExistingRawSourceMap, SourceMapInput } from 'rolldown'

export interface TscModule {
  program: ts.Program
  file: ts.SourceFile
}

export interface TscOptions {
  tsconfig?: string
  tsconfigRaw: TsConfigJson
  cwd: string
  build: boolean
  incremental: boolean
  entries?: string[]
  id: string
  vue?: boolean
  context?: TscContext
}

const debug = Debug('rolldown-plugin-dts:tsc')
debug(`loaded typescript: ${ts.version}`)

const formatHost: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
  getCanonicalFileName: ts.sys.useCaseSensitiveFileNames
    ? (f) => f
    : (f) => f.toLowerCase(),
}

const defaultCompilerOptions: ts.CompilerOptions = {
  declaration: true,
  noEmit: false,
  emitDeclarationOnly: true,
  noEmitOnError: true,
  checkJs: false,
  declarationMap: false,
  skipLibCheck: true,
  target: 99 satisfies ts.ScriptTarget.ESNext,
  resolveJsonModule: true,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
}

function createOrGetTsModule(options: TscOptions): TscModule {
  const { id, entries, context = globalContext } = options
  const program = context.programs.find((program) => {
    const roots = program.getRootFileNames()
    if (entries) {
      return entries.every((entry) => roots.includes(entry))
    }
    return roots.includes(id)
  })
  if (program) {
    const sourceFile = program.getSourceFile(id)
    if (sourceFile) {
      return { program, file: sourceFile }
    }
  }

  debug(`create program for module: ${id}`)
  const module = createTsProgram(options)
  debug(`created program for module: ${id}`)

  context.programs.push(module.program)
  return module
}

function parseTsconfig(
  tsconfigPath: string,
  fsSystem: ts.System,
): ts.ParsedCommandLine | undefined {
  const diagnostics: ts.Diagnostic[] = []

  const parsedConfig = ts.getParsedCommandLineOfConfigFile(
    tsconfigPath,
    undefined,
    {
      ...fsSystem,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic)
      },
    },
  )

  if (diagnostics.length) {
    throw new Error(
      `[rolldown-plugin-dts] Unable to read ${tsconfigPath}: ${ts.formatDiagnostics(diagnostics, formatHost)}`,
    )
  }

  return parsedConfig
}

function createTsProgram({
  entries,
  id,
  tsconfig,
  tsconfigRaw,
  vue,
  cwd,
  context = globalContext,
}: TscOptions): TscModule {
  const fsSystem = createFsSystem(context.files)
  const baseDir = tsconfig ? path.dirname(tsconfig) : cwd
  const parsedConfig = ts.parseJsonConfigFileContent(
    tsconfigRaw,
    fsSystem,
    baseDir,
  )

  debug(`Creating program for root project: ${baseDir}`)
  return createTsProgramFromParsedConfig({
    parsedConfig,
    fsSystem,
    baseDir,
    id,
    entries,
    vue,
  })
}

function createTsProgramFromParsedConfig({
  parsedConfig,
  fsSystem,
  baseDir,
  id,
  entries,
  vue,
}: {
  parsedConfig: ts.ParsedCommandLine
  fsSystem: ts.System
  baseDir: string
} & Pick<TscOptions, 'entries' | 'vue' | 'id'>): TscModule {
  const compilerOptions: ts.CompilerOptions = {
    ...defaultCompilerOptions,
    ...parsedConfig.options,
    $configRaw: parsedConfig.raw,
    $rootDir: baseDir,
  }

  const rootNames = [
    ...new Set(
      [id, ...(entries || parsedConfig.fileNames)].map((f) =>
        fsSystem.resolvePath(f),
      ),
    ),
  ]

  const host = ts.createCompilerHost(compilerOptions, true)

  const createProgram = vue ? createVueProgramFactory(ts) : ts.createProgram
  const program = createProgram({
    rootNames,
    options: compilerOptions,
    host,
    projectReferences: parsedConfig.projectReferences,
  })

  const sourceFile = program.getSourceFile(id)

  if (!sourceFile) {
    debug(`source file not found in program: ${id}`)

    const hasReferences = !!parsedConfig.projectReferences?.length

    if (hasReferences) {
      throw new Error(
        `[rolldown-plugin-dts] Unable to load ${id}. You have "references" in your tsconfig file. Maybe you want to add \`dts: { build: true }\` in your config?`,
      )
    }

    if (!fsSystem.fileExists(id)) {
      debug(`File ${id} does not exist on disk.`)
      throw new Error(`Source file not found: ${id}`)
    } else {
      debug(`File ${id} exists on disk.`)
      throw new Error(
        `Unable to load file ${id} from the program. This seems like a bug of rolldown-plugin-dts. Please report this issue to https://github.com/sxzz/rolldown-plugin-dts/issues`,
      )
    }
  }

  return {
    program,
    file: sourceFile,
  }
}

export interface TscResult {
  code?: string
  map?: SourceMapInput
  error?: string
}

export function tscEmit(tscOptions: TscOptions): TscResult {
  debug(`running tscEmit ${tscOptions.id}`)

  if (tscOptions.build) {
    return tscEmitBuild(tscOptions)
  } else {
    return tscEmitClassic(tscOptions)
  }
}

// Emit file using `tsc` mode (without `--build` flag).
function tscEmitClassic(tscOptions: TscOptions): TscResult {
  debug(`running tscEmitClassic ${tscOptions.id}`)

  const module = createOrGetTsModule(tscOptions)
  const { program, file } = module
  debug(`got source file: ${file.fileName}`)
  let dtsCode: string | undefined
  let map: SourceMapInput | undefined

  const { emitSkipped, diagnostics } = program.emit(
    file,
    (fileName, code) => {
      if (fileName.endsWith('.map')) {
        debug(`emit dts sourcemap: ${fileName}`)
        map = JSON.parse(code)
      } else {
        debug(`emit dts: ${fileName}`)
        dtsCode = code
      }
    },
    undefined,
    true,
    customTransformers,
    // @ts-expect-error private API: forceDtsEmit
    true,
  )
  if (emitSkipped && diagnostics.length) {
    return { error: ts.formatDiagnostics(diagnostics, formatHost) }
  }

  // If TypeScript skipped emitting because the file is already a .d.ts (e.g. a
  // redirected output from a composite project build), the emit callback above
  // will never be invoked. In that case, fall back to the text of the source
  // file itself so that callers still receive a declaration string.
  if (!dtsCode && file.isDeclarationFile) {
    debug('nothing was emitted. fallback to sourceFile text.')
    dtsCode = file.getFullText()
  }

  return { code: dtsCode, map }
}

// Emit file using `tsc --build` mode.
function tscEmitBuild(tscOptions: TscOptions): TscResult {
  const { id, tsconfig, incremental, context = globalContext } = tscOptions
  debug(
    `running tscEmitBuild id: ${id}, tsconfig: ${tsconfig}, incremental: ${incremental}`,
  )

  if (!tsconfig) {
    return {
      error: '[rolldown-plugin-dts] build mode requires a tsconfig path',
    }
  }

  const fsSystem = (incremental ? createFsSystem : createMemorySystem)(
    context.files,
  )

  const resolvedId = fsSystem.resolvePath(id)

  if (resolvedId !== id) {
    debug(`resolved id from ${id} to ${resolvedId}`)
  }

  // Build projects (if necessary) and collect all projects.
  const sourceFileToProjectMap = getOrBuildProjects(
    context,
    fsSystem,
    tsconfig,
    !incremental,
  )

  const project = sourceFileToProjectMap.get(resolvedId)
  if (!project) {
    debug(`unable to locate a project containing ${resolvedId}`)
    return {
      error: `Unable to locate ${id} from the given tsconfig file ${tsconfig}`,
    }
  }
  debug(`loaded project ${project.tsconfigPath} for ${id}`)

  const ignoreCase = !fsSystem.useCaseSensitiveFileNames
  const outputFiles = ts.getOutputFileNames(
    project.parsedConfig,
    resolvedId,
    ignoreCase,
  )

  let code: string | undefined
  let map: ExistingRawSourceMap | undefined

  for (const outputFile of outputFiles) {
    if (outputFile.endsWith('.d.ts')) {
      if (!fsSystem.fileExists(outputFile)) {
        console.warn(`[rolldown-plugin-dts] Unable to read file ${outputFile}`)
        continue
      }
      code = fsSystem.readFile(outputFile)
      continue
    }

    if (outputFile.endsWith('.d.ts.map')) {
      if (!fsSystem.fileExists(outputFile)) {
        continue
      }

      const text = fsSystem.readFile(outputFile)
      if (!text) {
        console.warn(`[rolldown-plugin-dts] Unexpected sourcemap ${outputFile}`)
        continue
      }

      map = JSON.parse(text)
      if (!map || map.sourceRoot) {
        continue
      }

      // Since `outputFile` and `resolvedId` might locate in different
      // directories, we need to explicitly set the `sourceRoot` of the source
      // map so that the final sourcemap has correct paths in `sources` field.
      const outputFileDir = path.posix.dirname(
        pathToFileURL(outputFile).pathname,
      )
      const resolvedIdDir = path.posix.dirname(
        pathToFileURL(resolvedId).pathname,
      )
      if (outputFileDir !== resolvedIdDir) {
        map.sourceRoot = path.posix.relative(resolvedIdDir, outputFileDir)
      }
    }
  }

  if (code) {
    return { code, map }
  }

  if (incremental) {
    debug(`incremental build failed`)
    // Fallback to non-incremental (force) build.
    //
    // This can happen if users delete the emitted files from `tsc --build`, but
    // still keep the `.tsbuildinfo` file exist. In this case, `tsc --build`
    // will skip the build, but the `.d.ts` file we need doesn't actually exist.
    return tscEmitBuild({ ...tscOptions, incremental: false })
  }

  debug(`unable to build .d.ts file for ${id}`)

  // Try to locate the cause of the failure and provide a helpful error message
  if (project.parsedConfig.options.declaration !== true) {
    return {
      error: `Unable to build .d.ts file for ${id}; Make sure the "declaration" option is set to true in ${project.tsconfigPath}`,
    }
  }

  return {
    error: `Unable to build .d.ts file for ${id}; This seems like a bug of rolldown-plugin-dts. Please report this issue to https://github.com/sxzz/rolldown-plugin-dts/issues`,
  }
}

function getOrBuildProjects(
  context: TscContext,
  fsSystem: ts.System,
  tsconfig: string,
  force: boolean,
): SourceFileToProjectMap {
  let projectMap = context.projects.get(tsconfig)
  if (projectMap) {
    debug(`skip building projects for ${tsconfig}`)
    return projectMap
  }

  projectMap = buildProjects(fsSystem, tsconfig, force)
  context.projects.set(tsconfig, projectMap)
  return projectMap
}

/**
 * Use TypeScript compiler to build all projects referenced
 */
function buildProjects(
  fsSystem: ts.System,
  tsconfig: string,
  force: boolean,
): SourceFileToProjectMap {
  debug(`start building projects for ${tsconfig}`)

  // Collect all projects from the tsconfig file and its references. A project
  // is a string that represents the path to the project's `tsconfig` file.
  const projects = collectProjectGraph(tsconfig, fsSystem)
  debug(
    'collected %d projects: %j',
    projects.length,
    projects.map((project) => project.tsconfigPath),
  )

  const host = ts.createSolutionBuilderHost(
    fsSystem,
    createProgramWithPatchedCompilerOptions,
  )
  const builder = ts.createSolutionBuilder(host, [tsconfig], {
    force,
    verbose: true,
  })

  const exitStatus = builder.build(
    undefined,
    undefined,
    undefined,
    () => customTransformers,
  )

  debug(`built solution for ${tsconfig} with exit status ${exitStatus}`)

  const sourceFileToProjectMap: SourceFileToProjectMap = new Map()

  for (const project of projects) {
    for (const fileName of project.parsedConfig.fileNames) {
      sourceFileToProjectMap.set(fsSystem.resolvePath(fileName), project)
    }
  }

  return sourceFileToProjectMap
}

/**
 * Collects all referenced projects from the given entry tsconfig file.
 */
function collectProjectGraph(
  rootTsconfigPath: string,
  fsSystem: ts.System,
): ParsedProject[] {
  const seen = new Set<string>()
  const projects: ParsedProject[] = []
  const stack = [fsSystem.resolvePath(rootTsconfigPath)]
  while (true) {
    const tsconfigPath = stack.pop()
    if (!tsconfigPath) break

    if (seen.has(tsconfigPath)) continue
    seen.add(tsconfigPath)

    const parsedConfig = parseTsconfig(tsconfigPath, fsSystem)
    if (!parsedConfig) continue

    parsedConfig.options = patchCompilerOptions(parsedConfig.options)

    projects.push({ tsconfigPath, parsedConfig })

    for (const ref of parsedConfig.projectReferences ?? []) {
      stack.push(ts.resolveProjectReferencePath(ref))
    }
  }
  return projects
}

// To ensure we can get `.d.ts` and `.d.ts.map` files from `tsc --build` mode,
// we need to enforce certain compiler options.
function patchCompilerOptions(options: ts.CompilerOptions): ts.CompilerOptions {
  return {
    ...options,
    noEmit: false,
    declaration: true,
    declarationMap: true,
  }
}

const createProgramWithPatchedCompilerOptions: ts.CreateProgram<
  ts.EmitAndSemanticDiagnosticsBuilderProgram
> = (rootNames, options, ...args) => {
  return ts.createEmitAndSemanticDiagnosticsBuilderProgram(
    rootNames,
    patchCompilerOptions(options ?? {}),
    ...args,
  )
}
