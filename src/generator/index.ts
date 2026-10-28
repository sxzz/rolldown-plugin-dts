import { OxcGenerator } from './oxc.ts'
import { TscGenerator } from './tsc.ts'
import { TsgoGenerator } from './tsgo.ts'
import type { OptionsResolved } from '../options.ts'
import type { RollupError, SourceMapInput } from 'rolldown'

export interface GeneratorResult {
  /** Generated declaration code. */
  code?: string
  /** Source map for the generated declaration. */
  map?: SourceMapInput
  /** Error reported through Rolldown when declaration generation fails. */
  error?: RollupError | string
}

/** A declaration generator used by the dts plugin. */
export interface Generator {
  /** Initializes resources at the start of each build. */
  init?: () => void | Promise<void>
  /** Registers transformed source code before declaration generation. */
  addFile?: (code: string, fileName: string) => void
  /** Generates a declaration for a source file. */
  emit: (
    code: string,
    fileName: string,
  ) => GeneratorResult | Promise<GeneratorResult>
  /** Releases resources at the end of each build. */
  dispose?: () => void | Promise<void>
  /** Invalidates cached state for a changed file in watch mode. */
  invalidate?: (fileName: string) => void
}

export function createGenerator(
  {
    generator,
    tsconfig,
    tsconfigRaw,
    cwd,
    oxc,
    languageContext,
    tsc,
    tsgo,
    tsrs,
    sourcemap,
  }: Pick<
    OptionsResolved,
    | 'generator'
    | 'tsconfig'
    | 'tsconfigRaw'
    | 'cwd'
    | 'oxc'
    | 'languageContext'
    | 'tsc'
    | 'tsgo'
    | 'tsrs'
    | 'sourcemap'
  >,
  getEntries: () => string[] | undefined,
  loadSource?: (fileName: string) => Promise<void>,
): Generator {
  if (typeof generator !== 'string') return generator

  if (generator === 'oxc') {
    return new OxcGenerator(oxc, languageContext)
  }

  if (generator === 'tsgo' || generator === 'tsrs') {
    const native = generator === 'tsrs' ? tsrs : tsgo
    return new TsgoGenerator({
      compiler: generator,
      moduleUrl: native.moduleUrl,
      tsgoPath: native.path,
      runExternalCode: native.runExternalCode,
      cwd,
      tsconfig: tsconfig!,
      vfs: !!native.vfs,
      languageContext,
      loadSource,
    })
  }

  return new TscGenerator({
    tsconfig,
    tsconfigRaw,
    build: tsc.build,
    incremental: tsc.incremental,
    cwd,
    sourcemap,
    languageContext,
    vue: tsc.vue,
    parallel: tsc.parallel,
    newContext: tsc.newContext,
    getEntries,
  })
}

export { OxcGenerator, TscGenerator, TsgoGenerator }
