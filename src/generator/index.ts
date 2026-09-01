import { OxcGenerator } from './oxc.ts'
import { TscGenerator } from './tsc.ts'
import { TsgoGenerator } from './tsgo.ts'
import type { OptionsResolved } from '../options.ts'
import type { RollupError, SourceMapInput } from 'rolldown'

export interface GeneratorResult {
  code?: string
  map?: SourceMapInput
  error?: RollupError | string
}

export interface Generator {
  init?: () => void | Promise<void>
  addFile?: (code: string, fileName: string) => void
  emit: (
    code: string,
    fileName: string,
  ) => GeneratorResult | Promise<GeneratorResult>
  dispose?: () => void | Promise<void>
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
    | 'parallel'
    | 'tsgo'
    | 'newContext'
    | 'sourcemap'
  >,
  getEntries: () => string[] | undefined,
): Generator {
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
    parallel,
    newContext,
    getEntries,
  })
}

export { OxcGenerator, TscGenerator, TsgoGenerator }
