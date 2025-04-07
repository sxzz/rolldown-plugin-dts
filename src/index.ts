import { createFakeJsPlugin } from './fake-js'
import { createGeneratePlugin } from './generate'
import type { IsolatedDeclarationsOptions } from 'oxc-transform'
import type { FunctionPluginHooks, Plugin } from 'rolldown'

// TODO https://github.com/rolldown/rolldown/pull/4050
type ResolveIdExtraOptions = Parameters<FunctionPluginHooks['resolveId']>[2]

export interface Options {
  isolatedDeclaration?: Omit<IsolatedDeclarationsOptions, 'sourcemap'>
  /**
   * dts file name alias `{ [filename]: path }`
   *
   * @example
   * ```ts
   * inputAlias: {
   *   'foo.d.ts': 'foo/index.d.ts',
   * }
   */
  inputAlias?: Record<string, string>
  external?: (
    id: string,
    importer: string,
    extraOptions: ResolveIdExtraOptions,
  ) => boolean | void
}

export function dts(options: Options = {}): Plugin[] {
  return [createGeneratePlugin(options), createFakeJsPlugin()]
}
