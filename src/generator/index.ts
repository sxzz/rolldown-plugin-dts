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
    build,
    incremental,
    cwd,
    oxc,
    languageContext,
    vue,
    parallel,
    tsgo,
    newContext,
    sourcemap,
  }: Pick<
    OptionsResolved,
    | 'generator'
    | 'tsconfig'
    | 'tsconfigRaw'
    | 'build'
    | 'incremental'
    | 'cwd'
    | 'oxc'
    | 'languageContext'
    | 'vue'
    | 'parallel'
    | 'tsgo'
    | 'newContext'
    | 'sourcemap'
  >,
  getEntries: () => string[] | undefined,
): Generator {
  if (typeof generator !== 'string') return generator

  if (generator === 'oxc') {
    return new OxcGenerator(oxc, languageContext)
  }

  if (generator === 'tsgo') {
    return new TsgoGenerator({
      moduleUrl: tsgo.moduleUrl,
      tsgoPath: tsgo.path,
      cwd,
      tsconfig: tsconfig!,
      vfs: !!tsgo.vfs,
      languageContext,
    })
  }

  return new TscGenerator({
    tsconfig,
    tsconfigRaw,
    build,
    incremental,
    cwd,
    sourcemap,
    languageContext,
    vue,
    parallel,
    newContext,
    getEntries,
  })
}

export { OxcGenerator, TscGenerator, TsgoGenerator }
