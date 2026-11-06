import { createDebug } from 'obug'
import { tscCheckBuild, tscEmitBuild } from './emit-build.ts'
import { tscCheckCompiler, tscEmitCompiler } from './emit-compiler.ts'
import type { TscCheckOptions, TscOptions, TscResult } from './types.ts'
export type {
  TscCheckOptions,
  TscModule,
  TscOptions,
  TscResult,
} from './types.ts'

const debug = createDebug('rolldown-plugin-dts:tsc')

export function tscEmit(tscOptions: TscOptions): TscResult {
  debug(`running tscEmit ${tscOptions.id}`)

  if (tscOptions.build) {
    return tscEmitBuild(tscOptions)
  } else {
    return tscEmitCompiler(tscOptions)
  }
}

/** Returns the type errors of the programs that emitted `ids`. */
export function tscCheck(options: TscCheckOptions): string | undefined {
  debug(`running tscCheck for ${options.ids.length} files`)
  return options.build ? tscCheckBuild(options) : tscCheckCompiler(options)
}
