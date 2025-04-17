import { createRequire } from 'node:module'
import Debug from 'debug'
import type { TsConfigJson } from 'get-tsconfig'
import type Ts from 'typescript'

const debug = Debug('rolldown-plugin-dts:tsc')

let ts: typeof Ts
let formatHost: Ts.FormatDiagnosticsHost

export function initTs(): void {
  debug('loading typescript')

  const require = createRequire(import.meta.url)
  ts = require('typescript')
  formatHost = {
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getNewLine: () => ts.sys.newLine,
    getCanonicalFileName: ts.sys.useCaseSensitiveFileNames
      ? (f) => f
      : (f) => f.toLowerCase(),
  }

  debug(`loaded typescript: ${ts.version}`)
}

const defaultCompilerOptions: Ts.CompilerOptions = {
  declaration: true,
  noEmit: false,
  emitDeclarationOnly: true,
  noEmitOnError: true,
  checkJs: false,
  declarationMap: false,
  skipLibCheck: true,
  preserveSymlinks: true,
  target: 99 satisfies Ts.ScriptTarget.ESNext,
  resolveJsonModule: true,
}

export interface TsProgram {
  program: Ts.Program
  files: Map<string, string>
}

export interface TsModule {
  program: TsProgram
  file: Ts.SourceFile
}

export function createOrGetTsModule(
  programs: TsProgram[],
  compilerOptions: TsConfigJson.CompilerOptions | undefined,
  id: string,
  code: string,
  isEntry?: boolean,
): TsModule {
  const tsProgram = programs.find(({ program }) => {
    if (isEntry) {
      return program.getRootFileNames().includes(id)
    }
    return program.getSourceFile(id)
  })
  if (tsProgram) {
    const sourceFile = tsProgram.program.getSourceFile(id)
    if (sourceFile) {
      return { program: tsProgram, file: sourceFile }
    }
  }

  debug(`create program for module: ${id}`)
  const module = createTsProgram(compilerOptions, id, code)
  debug(`created program for module: ${id}`)

  programs.push(module.program)
  return module
}

function createTsProgram(
  compilerOptions: TsConfigJson.CompilerOptions | undefined,
  id: string,
  code: string,
): TsModule {
  const files = new Map<string, string>([[id, code]])

  const overrideCompilerOptions: Ts.CompilerOptions =
    ts.convertCompilerOptionsFromJson(compilerOptions, '.').options

  const options: Ts.CompilerOptions = {
    ...defaultCompilerOptions,
    ...overrideCompilerOptions,
  }

  const host = ts.createCompilerHost(options, true)
  const { readFile: _readFile, fileExists: _fileExists } = host
  host.fileExists = (fileName) => {
    if (files.has(fileName)) return true
    return _fileExists(fileName)
  }
  host.readFile = (fileName) => {
    if (files.has(fileName)) return files.get(fileName)!
    return _readFile(fileName)
  }
  const program = ts.createProgram([id], options, host)
  const sourceFile = program.getSourceFile(id)
  if (!sourceFile) {
    throw new Error(`Source file not found: ${id}`)
  }

  return {
    program: {
      program,
      files,
    },
    file: sourceFile,
  }
}

export function tscEmit(module: TsModule): { code?: string; error?: string } {
  const {
    program: { program },
    file,
  } = module
  let dtsCode: string | undefined
  const { emitSkipped, diagnostics } = program.emit(
    file,
    (_, code) => {
      debug(`emit dts: ${file.fileName}`)
      dtsCode = code
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
  return { code: dtsCode }
}
