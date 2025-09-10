import path from 'node:path'
import Debug from 'debug'
import ts from 'typescript'
import { globalContext } from './context.ts'
import { createFsSystem } from './system.ts'
import { createTsMacroProgramFactory } from './ts-macro.ts'
import { customTransformers, formatHost, setSourceMapRoot } from './utils.ts'
import { createVueProgramFactory } from './vue.ts'
import type { TscModule, TscOptions, TscResult } from './types.ts'
import type { ExistingRawSourceMap } from 'rolldown'

const debug = Debug('rolldown-plugin-dts:tsc-compiler')

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

function createTsProgram({
  entries,
  id,
  tsconfig,
  tsconfigRaw,
  vue,
  tsMacro,
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
    tsMacro,
  })
}

function createTsProgramFromParsedConfig({
  parsedConfig,
  fsSystem,
  baseDir,
  id,
  entries,
  vue,
  tsMacro,
}: {
  parsedConfig: ts.ParsedCommandLine
  fsSystem: ts.System
  baseDir: string
} & Pick<TscOptions, 'entries' | 'vue' | 'tsMacro' | 'id'>): TscModule {
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

  const createProgram = vue
    ? createVueProgramFactory(ts)
    : tsMacro
      ? createTsMacroProgramFactory(ts)
      : ts.createProgram
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
        `[rolldown-plugin-dts] Unable to load ${id}; You have "references" in your tsconfig file. Perhaps you want to add \`dts: { build: true }\` in your config?`,
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

// Emit file using `tsc` mode (without `--build` flag).
export function tscEmitCompiler(tscOptions: TscOptions): TscResult {
  debug(`running tscEmitCompiler ${tscOptions.id}`)

  const module = createOrGetTsModule(tscOptions)
  const { program, file } = module
  debug(`got source file: ${file.fileName}`)
  let dtsCode: string | undefined
  let map: ExistingRawSourceMap | undefined

  const { emitSkipped, diagnostics } = program.emit(
    file,
    (fileName, code) => {
      if (fileName.endsWith('.map')) {
        debug(`emit dts sourcemap: ${fileName}`)
        map = JSON.parse(code)
        setSourceMapRoot(map, fileName, tscOptions.id)
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
