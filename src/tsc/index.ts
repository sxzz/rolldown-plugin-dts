import { createDebug } from 'obug'
import { tscEmitBuild } from './emit-build.ts'
import { tscEmitCompiler } from './emit-compiler.ts'
import type { TscOptions, TscResult } from './types.ts'
export type { TscModule, TscOptions, TscResult } from './types.ts'

const debug = createDebug('rolldown-plugin-dts:tsc')

/**
 * Emits TypeScript declaration files for a single source file. Dispatches to
 * {@linkcode tscEmitBuild()} when {@linkcode TscOptions.build | build} is
 * `true`, otherwise uses {@linkcode tscEmitCompiler()}.
 *
 * @param tscOptions - The options for emitting the declaration file, including the path to the source file, project configuration, and whether to use {@linkcode https://www.typescriptlang.org/docs/handbook/project-references.html#build-mode-for-typescript | tsc --build} mode.
 * @returns A {@linkcode TscResult | result} with the generated {@linkcode TscResult.code | code}, {@linkcode TscResult.map | sourcemap}, or an {@linkcode TscResult.error | error message}.
 */
export function tscEmit(tscOptions: TscOptions): TscResult {
  debug(`running tscEmit ${tscOptions.id}`)

  if (tscOptions.build) {
    return tscEmitBuild(tscOptions)
  } else {
    return tscEmitCompiler(tscOptions)
  }
}
