import { createFakeJsPlugin } from './fake-js'
import { createGeneratePlugin } from './generate'
import type { IsolatedDeclarationsOptions } from 'oxc-transform'
import type { FunctionPluginHooks, Plugin } from 'rolldown'

// TODO https://github.com/rolldown/rolldown/pull/4050
type ResolveIdExtraOptions = Parameters<FunctionPluginHooks['resolveId']>[2]

export interface Options {
  /**
   * When entries are `.dts` files (instead of `.ts` files), this option should be set to `true`.
   *
   * If enabled, the plugin will skip generating a `.dts` file for the entry point.
   */
  dtsInput?: boolean

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
  return [createGeneratePlugin(options), createFakeJsPlugin(options)]
}

export { createFakeJsPlugin, createGeneratePlugin }
