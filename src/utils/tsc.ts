import Debug from 'debug'
import ts from 'typescript'
import type { DtsMap, TsModule } from '../generate.ts'
import { RE_NODE_MODULES } from './filename.ts'
import { createVueProgramFactory } from './vue.ts'
import type { TsConfigJson } from 'get-tsconfig'

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

export interface TscModule {
  program: ts.Program
  file: ts.SourceFile
}

export interface TscOptions {
  programs: ts.Program[]
  compilerOptions: TsConfigJson.CompilerOptions | undefined
  references: TsConfigJson.References[] | undefined
  id: string
  isEntry: boolean
  dtsMap: [string, TsModule][]
  vue?: boolean
}

function createOrGetTsModule({
  programs,
  compilerOptions,
  references,
  id,
  isEntry,
  dtsMap,
  vue,
}: TscOptions): TscModule {
  const program = programs.find((program) => {
    if (isEntry) {
      return program.getRootFileNames().includes(id)
    }
    return program.getSourceFile(id)
  })
  if (program) {
    const sourceFile = program.getSourceFile(id)
    if (sourceFile) {
      return { program, file: sourceFile }
    }
  }

  debug(`create program for module: ${id}`)
  const module = createTsProgram(
    compilerOptions,
    references,
    new Map(dtsMap),
    id,
    vue,
  )
  debug(`created program for module: ${id}`)

  programs.push(module.program)
  return module
}

function createTsProgram(
  compilerOptions: TsConfigJson.CompilerOptions | undefined,
  references: TsConfigJson.References[] | undefined,
  dtsMap: DtsMap,
  id: string,
  vue?: boolean,
): TscModule {
  const overrideCompilerOptions: ts.CompilerOptions =
    ts.convertCompilerOptionsFromJson(compilerOptions, '.').options

  const options: ts.CompilerOptions = {
    ...defaultCompilerOptions,
    ...overrideCompilerOptions,
  }

  const host = ts.createCompilerHost(options, true)
  const { readFile: _readFile, fileExists: _fileExists } = host
  host.fileExists = (fileName) => {
    const module = getTsModule(dtsMap, fileName)
    if (module) return true
    if (debug.enabled && !RE_NODE_MODULES.test(fileName)) {
      debug(`file exists from fs: ${fileName}`)
    }
    return _fileExists(fileName)
  }
  host.readFile = (fileName) => {
    const module = getTsModule(dtsMap, fileName)
    if (module) return module.code
    if (debug.enabled && !RE_NODE_MODULES.test(fileName)) {
      debug(`read file from fs: ${fileName}`)
    }
    return _readFile(fileName)
  }

  const entries = [
    ...new Set([
      ...Array.from(dtsMap.values())
        .filter((v) => v.isEntry)
        .map((v) => v.id),
      id,
    ]),
  ]
  const createProgram = vue ? createVueProgramFactory(ts) : ts.createProgram
  const program = createProgram({
    rootNames: entries,
    options,
    host,
    projectReferences: references,
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

function getTsModule(dtsMap: DtsMap, tsId: string) {
  const module = Array.from(dtsMap.values()).find((dts) => dts.id === tsId)
  if (!module) return
  return module
}
