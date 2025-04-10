import { createFakeJsPlugin } from './fake-js'
import { createGeneratePlugin } from './generate'
import type { IsolatedDeclarationsOptions } from 'oxc-transform'
import type { Plugin } from 'rolldown'

export interface Options {
  /**
   * When entries are `.d.ts` files (instead of `.ts` files), this option should be set to `true`.
   *
   * If enabled, the plugin will skip generating a `.d.ts` file for the entry point.
   */
  dtsInput?: boolean
  /**
   * When `true`, the plugin will only emit `.d.ts` files and remove all other chunks.
   *
   * This feature is particularly beneficial when you need to generate `d.ts` files for the CommonJS format as part of a separate build process.
   */
  emitDtsOnly?: boolean

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

  /** Resolve external types used in dts files from `node_modules` */
  resolve?: boolean | (string | RegExp)[]
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
