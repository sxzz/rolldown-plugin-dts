import type { VolarContext } from '../volar.ts'
import type { TscContext } from './context.ts'
import type { TsconfigJson } from 'get-tsconfig'
import type { SourceMapInput } from 'rolldown'
import type * as ts from 'typescript'

/**
 * Holds the TypeScript {@linkcode ts.Program | program} and
 * {@linkcode ts.SourceFile | SourceFile} for a module being processed by the
 * TypeScript compiler, cached inside a {@linkcode TscContext | context} to
 * avoid re-parsing on every build.
 */
export interface TscModule {
  /**
   * The {@linkcode ts.Program | program} for the module. This is used to emit
   * the TypeScript code for the module. The {@linkcode ts.Program | program}
   * is created using the TypeScript compiler API and is set up with the
   * necessary {@linkcode ts.CompilerOptions | compilerOptions} and
   * {@linkcode ts.CompilerHost | host} for the module.
   */
  program: ts.Program

  /**
   * The {@linkcode ts.SourceFile | SourceFile} for the module. This is the
   * parsed representation of the source file, used to locate the specific
   * file within the {@linkcode ts.Program | program} when emitting
   * declarations.
   */
  file: ts.SourceFile
}

export interface TscOptions {
  tsconfig?: string
  tsconfigRaw: TsconfigJson
  cwd: string
  build: boolean
  incremental: boolean

  /**
   * Entry file paths passed to the TypeScript compiler to scope the program.
   */
  entries?: string[]

  /**
   * The source file path being emitted in this invocation.
   */
  id: string
  sourcemap: boolean
  volarContext?: VolarContext

  /**
   * The context for the TypeScript compiler. This is used to store the
   * programs created by the compiler and other related information.
   *
   * @default globalContext
   */
  context?: TscContext
}

/**
 * The result of a TypeScript declaration emit operation. Exactly one of
 * {@linkcode TscResult.code | code} or {@linkcode TscResult.error | error}
 * will be defined: {@linkcode TscResult.code | code} when compilation
 * succeeded, {@linkcode TscResult.error | error} when it failed.
 * {@linkcode TscResult.map | map} is only present when sourcemaps are
 * enabled and {@linkcode TscResult.code | code} is defined.
 */
export interface TscResult {
  /**
   * The generated `.d.ts` declaration code, if compilation succeeded.
   */
  code?: string

  /**
   * The source map for the generated `.d.ts` file, if sourcemaps are enabled.
   */
  map?: SourceMapInput

  /**
   * An error message string if the TypeScript compilation failed.
   */
  error?: string
}
