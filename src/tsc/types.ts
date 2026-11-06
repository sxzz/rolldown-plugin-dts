import type { LanguageContext } from '../custom-language.ts'
import type { TscContext } from './context.ts'
import type { TsconfigJson } from 'get-tsconfig'
import type { SourceMapInput } from 'rolldown'
import type * as ts from 'typescript'

export interface TscModule {
  program: ts.Program
  file: ts.SourceFile
}

export interface TscOptions {
  tsconfig?: string
  tsconfigRaw: TsconfigJson
  cwd: string
  build: boolean
  incremental: boolean
  entries?: string[]
  id: string
  sourcemap: boolean
  typecheck?: boolean
  languageContext: LanguageContext
  context?: TscContext
}

export type TscCheckOptions = Omit<TscOptions, 'id'> & {
  /** Files emitted during the build. */
  ids: string[]
}

export interface TscResult {
  code?: string
  map?: SourceMapInput
  error?: string
}
