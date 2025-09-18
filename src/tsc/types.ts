import type { TscContext } from './context.ts'
import type { Ts } from './require-tsc.ts'
import type { TsConfigJson } from 'get-tsconfig'
import type { SourceMapInput } from 'rolldown'

export interface TscModule {
  program: Ts.Program
  file: Ts.SourceFile
}

export interface TscOptions {
  tsconfig?: string
  tsconfigRaw: TsConfigJson
  cwd: string
  build: boolean
  incremental: boolean
  entries?: string[]
  id: string
  sourcemap: boolean
  vue?: boolean
  tsMacro?: boolean
  context?: TscContext
}

export interface TscResult {
  code?: string
  map?: SourceMapInput
  error?: string
}
