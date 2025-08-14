import path from 'node:path'
import Debug from 'debug'
import ts from 'typescript'
import { globalContext, type TscContext } from './context.ts'
import { createFsSystem, createMemorySystem } from './system.ts'
import { createVueProgramFactory } from './vue.ts'
import type { TsConfigJson } from 'get-tsconfig'
import type { SourceMapInput } from 'rolldown'

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

/**
 * Build the root project and all its dependencies projects.
 * This is designed for a project (e.g. tsconfig.json) that has "references" to
 * other composite projects (e.g., tsconfig.node.json and tsconfig.app.json).
 * If `incremental` is `true`, the build result will be cached in the
 * `.tsbuildinfo` file so that the next time the project is built (without
 * changes) the build will be super fast. If `incremental` is `false`, the
 * `.tsbuildinfo` file will only be written to the memory.
 */
function buildSolution(
  tsconfig: string,
  incremental: boolean,
  context: TscContext,
) {
  debug(`building projects for ${tsconfig} with incremental: ${incremental}`)
  const system = (incremental ? createFsSystem : createMemorySystem)(
    context.files,
  )

  const host = ts.createSolutionBuilderHost(system)
  const builder = ts.createSolutionBuilder(host, [tsconfig], {
    // If `incremental` is `false`, we want to force the builder to rebuild the
    // project even if the project is already built (i.e., `.tsbuildinfo` exists
    // on the disk).
    force: !incremental,
    verbose: true,
  })

  // Collect all projects in the solution using the `getCustomTransformers`
  // callback. This doesn't seem to be the intended use of the callback, but
  // it's an easy way to collect all projects at any nesting level without the
  // need to implement the traversing logic ourselves.
  //
  // A project is a string that represents the path to the project's `tsconfig`
  // file.
  const projects: string[] = []
  const getCustomTransformers = (project: string): ts.CustomTransformers => {
    projects.push(project)
    return {}
  }

  const exitStatus = builder.build(
    undefined,
    undefined,
    undefined,
    getCustomTransformers,
  )

  debug(`built solution for ${tsconfig} with exit status ${exitStatus}`)
  return Array.from(new Set(projects))
}

function findProjectContainingFile(
  projects: string[],
  targetFile: string,
  fsSystem: ts.System,
): { parsedConfig: ts.ParsedCommandLine; tsconfigPath: string } | undefined {
  const resolvedTargetFile = fsSystem.resolvePath(targetFile)

  for (const tsconfigPath of projects) {
    const parsedConfig = parseTsconfig(tsconfigPath, fsSystem)
    if (
      parsedConfig &&
      parsedConfig.fileNames.some(
        (fileName) => fsSystem.resolvePath(fileName) === resolvedTargetFile,
      )
    ) {
      return { parsedConfig, tsconfigPath }
    }
  }
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
  build,
  incremental,
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

  // If the tsconfig has project references, build the project tree.
  if (tsconfig && build) {
    // Build the project tree and collect all projects.
    const projectPaths = buildSolution(tsconfig, incremental, context)
    debug(`collected projects: ${JSON.stringify(projectPaths)}`)

    // Find which project contains the source file
    const project = findProjectContainingFile(projectPaths, id, fsSystem)

    if (project) {
      debug(`Creating program for project: ${project.tsconfigPath}`)

      return createTsProgramFromParsedConfig({
        parsedConfig: project.parsedConfig,
        fsSystem,
        baseDir: path.dirname(project.tsconfigPath),
        id,
        entries,
        vue,
      })
    }
  }

  // If the tsconfig doesn't have project references, create a single program
  // for the root project.
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

  // Try to read files from memory first, which was added by `buildSolution`
  host.readFile = fsSystem.readFile
  host.fileExists = fsSystem.fileExists
  host.directoryExists = fsSystem.directoryExists

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
  const module = createOrGetTsModule(tscOptions)
  const { program, file } = module
  debug(`got source file: ${file.fileName}`)

  let dtsCode: string | undefined
  let map: SourceMapInput | undefined

  // fix #77
  const stripPrivateFields: ts.TransformerFactory<ts.SourceFile> = (ctx) => {
    const visitor = (node: ts.Node) => {
      if (ts.isPropertySignature(node) && ts.isPrivateIdentifier(node.name)) {
        return ctx.factory.updatePropertySignature(
          node,
          node.modifiers,
          ctx.factory.createStringLiteral(node.name.text),
          node.questionToken,
          node.type,
        )
      }
      return ts.visitEachChild(node, visitor, ctx)
    }
    return (sourceFile) =>
      ts.visitNode(sourceFile, visitor, ts.isSourceFile) ?? sourceFile
  }

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
    { afterDeclarations: [stripPrivateFields] },
    // @ts-expect-error private API: forceDtsEmit
    true,
  )
  const emitErrors = diagnostics.filter(
    (d: ts.Diagnostic) => d.category === ts.DiagnosticCategory.Error,
  )
  if (emitErrors.length > 0) {
    return { error: ts.formatDiagnostics(emitErrors, formatHost) }
  }
  if (emitSkipped) {
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter((d: ts.Diagnostic) => d.category === ts.DiagnosticCategory.Error)
    if (errors.length > 0) {
      return { error: ts.formatDiagnostics(errors, formatHost) }
    }
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
