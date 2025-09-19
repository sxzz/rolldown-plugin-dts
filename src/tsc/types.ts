import type { TscContext } from './context.ts'
import type { TsConfigJson } from 'get-tsconfig'
import type { SourceMapInput } from 'rolldown'
import type ts from 'typescript'

export interface TscModule {
  program: ts.Program
  file: ts.SourceFile
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
