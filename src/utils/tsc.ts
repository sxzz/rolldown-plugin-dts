import { createRequire } from 'node:module'
import Debug from 'debug'
import type { DtsMap } from '../generate.ts'
import { RE_NODE_MODULES, RE_VUE } from './filename.ts'
import { createVueProgramFactory } from './vue.ts'
import type { TsConfigJson } from 'get-tsconfig'
import type Ts from 'typescript'

const debug = Debug('rolldown-plugin-dts:tsc')

// eslint-disable-next-line import/no-mutable-exports
export let ts: typeof Ts
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

export interface TscModule {
  program: Ts.Program
  file: Ts.SourceFile
}

export function createOrGetTsModule(
  programs: Ts.Program[],
  compilerOptions: TsConfigJson.CompilerOptions | undefined,
  id: string,
  isEntry: boolean,
  dtsMap: DtsMap,
): TscModule {
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
  const module = createTsProgram(compilerOptions, dtsMap, id)
  debug(`created program for module: ${id}`)

  programs.push(module.program)
  return module
}

function createTsProgram(
  compilerOptions: TsConfigJson.CompilerOptions | undefined,
  dtsMap: DtsMap,
  id: string,
): TscModule {
  const overrideCompilerOptions: Ts.CompilerOptions =
    ts.convertCompilerOptionsFromJson(compilerOptions, '.').options

  const options: Ts.CompilerOptions = {
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
  const createProgram = entries.some((id) => RE_VUE.test(id))
    ? createVueProgramFactory()
    : ts.createProgram
  const program = createProgram({
    rootNames: Array.from(entries),
    options,
    host,
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

export function tscEmit(module: TscModule): {
  code?: string
  map?: any
  error?: string
} {
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
