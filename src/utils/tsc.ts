import path from 'node:path'
import Debug from 'debug'
import ts from 'typescript'
import { createVueProgramFactory } from './vue.ts'
import type { TsConfigJson } from 'get-tsconfig'
import type { SourceMapInput } from 'rolldown'

const debug = Debug('rolldown-plugin-dts:tsc')
debug(`loaded typescript: ${ts.version}`)

const programs: ts.Program[] = []

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

export interface TscModule {
  program: ts.Program
  file: ts.SourceFile
}

export interface TscOptions {
  tsconfig?: string
  tsconfigRaw: TsConfigJson
  cwd: string
  entries?: string[]
  id: string
  vue?: boolean
}

function createOrGetTsModule(options: TscOptions): TscModule {
  const { id, entries } = options
  const program = programs.find((program) => {
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

  programs.push(module.program)
  return module
}

// Build the root project and all its dependencies projects.
//
// This is designed for a project (e.g. tsconfig.json) that has "references" to
// other composite projects (e.g., tsconfig.node.json and tsconfig.app.json).
//
// The build result will be cached in the `.tsbuildinfo` file so that the next
// time the project is built (without changes) the build will be super fast.
function buildSolution(tsconfig: string) {
  debug(`building projects for ${tsconfig}`)

  // Update the system to log tsc output to the debug
  const system: ts.System = {
    ...ts.sys,
    write: (s: string): void => {
      debug(s)
    },
  }

  const host = ts.createSolutionBuilderHost(system)
  const builder = ts.createSolutionBuilder(host, [tsconfig], {
    force: false,
    verbose: true,
  })

  const exitStatus = builder.build()
  debug(`built solution for ${tsconfig} with exit status ${exitStatus}`)
}

function createTsProgram({
  entries,
  id,
  tsconfig,
  tsconfigRaw,
  vue,
  cwd,
}: TscOptions): TscModule {
  const parsedCmd = ts.parseJsonConfigFileContent(
    tsconfigRaw,
    ts.sys,
    tsconfig ? path.dirname(tsconfig) : cwd,
  )

  // If the tsconfig has project references, build the project tree.
  if (tsconfig && parsedCmd.projectReferences?.length) {
    buildSolution(tsconfig)
  }

  const compilerOptions: ts.CompilerOptions = {
    ...defaultCompilerOptions,
    ...parsedCmd.options,
  }
  const rootNames = [
    ...new Set(
      [id, ...(entries || parsedCmd.fileNames)].map((f) =>
        ts.sys.resolvePath(f),
      ),
    ),
  ]

  const host = ts.createCompilerHost(compilerOptions, true)
  const createProgram = vue ? createVueProgramFactory(ts) : ts.createProgram
  const program = createProgram({
    rootNames,
    options: compilerOptions,
    host,
    projectReferences: parsedCmd.projectReferences,
  })

  const sourceFile = program.getSourceFile(id)

  if (!sourceFile) {
    debug(`source file not found in program: ${id}`)
    if (!ts.sys.fileExists(id)) {
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
    undefined,
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
