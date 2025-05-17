import Debug from 'debug'
import ts from 'typescript'
import { createVueProgramFactory } from './vue.ts'
import type { TsConfigJson } from 'get-tsconfig'

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
  tsconfigRaw: TsConfigJson
  tsconfigDir: string
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

function createTsProgram({
  entries,
  id,
  tsconfigRaw,
  tsconfigDir,
  vue,
}: TscOptions): TscModule {
  const parsedCmd = ts.parseJsonConfigFileContent(
    tsconfigRaw,
    ts.sys,
    tsconfigDir,
  )
  const compilerOptions: ts.CompilerOptions = {
    ...defaultCompilerOptions,
    ...parsedCmd.options,
  }
  const rootNames = [...new Set([id, ...(entries || parsedCmd.fileNames)])]

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
    throw new Error(`Source file not found: ${id}`)
  }

  return {
    program,
    file: sourceFile,
  }
}

export interface TscResult {
  code?: string
  map?: any
  error?: string
}

export function tscEmit(tscOptions: TscOptions): TscResult {
  const module = createOrGetTsModule(tscOptions)
  const { program, file } = module
  let dtsCode: string | undefined
  let map: any
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
  return { code: dtsCode, map }
}
