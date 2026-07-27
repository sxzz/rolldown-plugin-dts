import path from 'node:path'
import { createDebug } from 'obug'
import { globalContext } from './context.ts'
import { requireTS } from './load-tsc.ts'
import { createFsSystem } from './system.ts'
import { customTransformers, formatHost, setSourceMapRoot } from './utils.ts'
import type { TscModule, TscOptions, TscResult } from './types.ts'
import type { ExistingRawSourceMap } from 'rolldown'
import type {
  CompilerOptions,
  ParsedCommandLine,
  ScriptTarget,
  System,
} from 'typescript'

const debug = createDebug('rolldown-plugin-dts:tsc-compiler')
const ts = requireTS()

const defaultCompilerOptions: CompilerOptions = {
  declaration: true,
  noEmit: false,
  emitDeclarationOnly: true,
  noEmitOnError: true,
  checkJs: false,
  declarationMap: false,
  skipLibCheck: true,
  target: 99 satisfies ScriptTarget.ESNext,
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
  languageContext,
  cwd,
  context = globalContext,
}: TscOptions): TscModule {
  const fsSystem = createFsSystem(context.files)
  const baseDir = tsconfig ? path.dirname(tsconfig) : cwd
  const parsedConfig = ts.parseJsonConfigFileContent(
    tsconfigRaw,
    fsSystem,
    baseDir,
    undefined,
    undefined,
    undefined,
    languageContext.getExtraFileExtensions(),
  )

  debug(`creating program for root project: ${baseDir}`)
  return createTsProgramFromParsedConfig({
    parsedConfig,
    fsSystem,
    baseDir,
    id,
    entries,
    languageContext,
  })
}

function createTsProgramFromParsedConfig({
  parsedConfig,
  fsSystem,
  baseDir,
  id,
  entries,
  languageContext,
}: {
  parsedConfig: ParsedCommandLine
  fsSystem: System
  baseDir: string
} & Pick<TscOptions, 'entries' | 'languageContext' | 'id'>): TscModule {
  const compilerOptions: CompilerOptions = {
    ...defaultCompilerOptions,
    ...parsedConfig.options,
    $configRaw: parsedConfig.raw,
    $rootDir: baseDir,
    // Allow non-TS extensions (e.g. `.vue`) to be used as root files. Without
    // this, TypeScript silently drops root files whose extension is not in its
    // built-in supported list, so `program.getSourceFile(id)` returns
    // `undefined` for a `.vue` entry that is not imported by a `.ts` file.
    // Only relevant when a custom language (e.g. Vue) registers such
    // extensions; module resolution already handles the imported-file case.
    ...(languageContext.languages.length
      ? { allowNonTsExtensions: true }
      : undefined),
  }

  const rootNames = [
    ...new Set(
      [id, ...(entries || parsedConfig.fileNames)].map((f) =>
        fsSystem.resolvePath(f),
      ),
    ),
  ]

  const host = ts.createCompilerHost(compilerOptions, true)
  const createProgram = languageContext.getCreateProgram(ts)
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

    if (fsSystem.fileExists(id)) {
      debug(`File ${id} exists on disk.`)
      throw new Error(
        `Unable to load file ${id} from the program. This seems like a bug of rolldown-plugin-dts. Please report this issue to https://github.com/sxzz/rolldown-plugin-dts/issues`,
      )
    } else {
      debug(`File ${id} does not exist on disk.`)
      throw new Error(`Source file not found: ${id}`)
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
  if (!dtsCode) {
    debug('nothing was emitted.')

    if (file.isDeclarationFile) {
      debug('source file is a declaration file.')
      dtsCode = file.getFullText()
    } else {
      console.warn(
        '[rolldown-plugin-dts] Warning: Failed to emit declaration file. Please try to enable `eager` option (`dts.eager` for tsdown).',
      )
    }
  }

  return { code: dtsCode, map }
}
