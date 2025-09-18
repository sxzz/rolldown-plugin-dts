import Debug from 'debug'
import { tscEmitBuild } from './emit-build.ts'
import { tscEmitCompiler } from './emit-compiler.ts'
import { ts } from './require-tsc.ts'
import type { TscOptions, TscResult } from './types.ts'

export type { TscModule, TscOptions, TscResult } from './types.ts'

const debug = Debug('rolldown-plugin-dts:tsc')
debug(`loaded typescript: ${ts.version}`)

export function tscEmit(tscOptions: TscOptions): TscResult {
  debug(`running tscEmit ${tscOptions.id}`)

  if (tscOptions.build) {
    return tscEmitBuild(tscOptions)
  } else {
    return tscEmitCompiler(tscOptions)
  }
}
