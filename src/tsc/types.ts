import type { Options, OptionsResolved } from '../options.ts'
import type { TscContext } from './context.ts'
import type { SourceMapInput } from 'rolldown'
import type ts from 'typescript'

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

/**
 * Internal options passed to the TypeScript compiler emission functions
 * (`tscEmit`, `tscEmitCompiler`, `tscEmitBuild`). Derived from
 * {@linkcode OptionsResolved | OptionsResolved} after `resolveOptions` has
 * been applied.
 */
export interface TscOptions
  extends
    Required<
      Pick<
        Options,
        'build' | 'cwd' | 'incremental' | 'sourcemap' | 'tsconfigRaw'
      >
    >,
    Pick<Options, 'tsconfig' | 'tsMacro' | 'vue'> {
  /**
   * Narrows the inherited `tsconfig` type from `string | boolean | undefined`
   * to `string | undefined`. By this point `resolveOptions` has already
   * converted `false` to `undefined` and resolved any relative path.
   */
  tsconfig?: string

  /**
   * Entry file paths passed to the TypeScript compiler to scope the program.
   */
  entries?: string[]

  /**
   * The source file path being emitted in this invocation.
   */
  id: string

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
