import path from 'node:path'
import * as ts from 'typescript'

const defaultCompilerOptions: ts.CompilerOptions = {
  declaration: true,
  noEmit: false,
  emitDeclarationOnly: true,
  noEmitOnError: true,
  checkJs: false,
  declarationMap: false,
  skipLibCheck: true,
  preserveSymlinks: true,
  target: ts.ScriptTarget.ESNext,
  resolveJsonModule: true,
}

export const formatHost: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
  getCanonicalFileName: ts.sys.useCaseSensitiveFileNames
    ? (f) => f
    : (f) => f.toLowerCase(),
}

export interface TsProgram {
  program: ts.Program
  files: Map<string, string>
}

export interface TsModule {
  program: TsProgram
  file: ts.SourceFile
}

export function createOrGetTsModule(
  programs: TsProgram[],
  compilerOptions: ts.CompilerOptions | undefined,
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

  const module = createTsProgram(compilerOptions, id, code)
  programs.push(module.program)
  return module
}

function createTsProgram(
  compilerOptions: ts.CompilerOptions | undefined,
  id: string,
  code: string,
): TsModule {
  const files = new Map<string, string>([[id, code]])

  const options: ts.CompilerOptions = {
    ...defaultCompilerOptions,
    ...loadTsconfig(id),
    ...compilerOptions,
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
  const program = ts.createProgram(
    [id],
    {
      ...compilerOptions,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      declaration: true,
      emitDeclarationOnly: true,
      outDir: undefined,
      declarationDir: undefined,
    },
    host,
  )
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

const tsconfigCache = new Map<string, ts.CompilerOptions>()

function loadTsconfig(id: string) {
  const configPath = ts.findConfigFile(path.dirname(id), ts.sys.fileExists)
  if (!configPath) return {}

  if (tsconfigCache.has(configPath)) {
    return tsconfigCache.get(configPath)!
  }

  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile)
  if (error) {
    throw ts.formatDiagnostic(error, formatHost)
  }

  const configContents = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath),
  )
  if (configContents.errors.length) {
    throw ts.formatDiagnostics(configContents.errors, formatHost)
  }
  tsconfigCache.set(configPath, configContents.options)
  return configContents.options
}
