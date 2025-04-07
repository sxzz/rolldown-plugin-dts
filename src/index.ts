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

  /**
   * Determines whether the module imported by `.dts` files should be treated as external or not.
   */
  external?: (
    id: string,
    importer: string,
    extraOptions: ResolveIdExtraOptions,
  ) => boolean | void
}

export function dts(options: Options = {}): Plugin[] {
  const plugins: Plugin[] = []
  if (!options.dtsInput) {
    plugins.push(createGeneratePlugin(options))
  }
  plugins.push(createFakeJsPlugin(options))
  return plugins
}

export { createFakeJsPlugin, createGeneratePlugin }
