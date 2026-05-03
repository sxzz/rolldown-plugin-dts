import { createDebug } from 'obug'
import { createDtsInputPlugin } from './dts-input.ts'
import { createFakeJsPlugin } from './fake-js.ts'
import { createGeneratePlugin } from './generate.ts'
import { resolveOptions, type Options } from './options.ts'
import { createDtsResolvePlugin } from './resolver.ts'
import type { Plugin } from 'rolldown'

const debug = createDebug('rolldown-plugin-dts:options')

/**
 * Creates a set of Rolldown plugins that generate and bundle `.d.ts`
 * declaration files alongside your source build.
 *
 * @param [options] - Configuration {@linkcode Options | options} for the plugin.
 * @returns An array of Rolldown {@linkcode Plugin | plugins} to include in your config.
 *
 * @example
 * <caption>Basic usage in `rolldown.config.ts`</caption>
 *
 * ```ts
 * import { defineConfig } from 'rolldown';
 * import { dts } from 'rolldown-plugin-dts';
 *
 * export default defineConfig({
 *   input: './src/index.ts',
 *   plugins: [dts()],
 *   output: [{ dir: 'dist', format: 'es' }],
 * });
 * ```
 *
 * @example
 * <caption>Emit DTS only for a separate CommonJS build</caption>
 *
 * ```ts
 * import { defineConfig } from 'rolldown';
 * import { dts } from 'rolldown-plugin-dts';
 *
 * export default defineConfig({
 *   input: './src/index.ts',
 *   plugins: [dts({ emitDtsOnly: true })],
 *   output: [{ dir: 'dist', format: 'cjs' }],
 * });
 * ```
 */
export function dts(options: Options = {}): Plugin[] {
  debug('resolving dts options')
  const resolved = resolveOptions(options)
  debug('resolved dts options %o', resolved)

  const plugins: Plugin[] = []
  if (options.dtsInput) {
    plugins.push(createDtsInputPlugin(resolved))
  } else {
    plugins.push(createGeneratePlugin(resolved))
  }
  plugins.push(createDtsResolvePlugin(resolved), createFakeJsPlugin(resolved))
  return plugins
}

export {
  createFakeJsPlugin,
  createGeneratePlugin,
  resolveOptions,
  type Options,
}
