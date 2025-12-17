import { createDebug } from 'obug'
import { createDtsInputPlugin } from './dts-input.ts'
import { createFakeJsPlugin } from './fake-js.ts'
import { createGeneratePlugin } from './generate.ts'
import { resolveOptions, type Options } from './options.ts'
import { createDtsResolvePlugin } from './resolver.ts'
import type { Plugin } from 'rolldown'

export {
  RE_CSS,
  RE_DTS,
  RE_DTS_MAP,
  RE_JS,
  RE_JSON,
  RE_NODE_MODULES,
  RE_TS,
  RE_VUE,
} from './filename.ts'

const debug = createDebug('rolldown-plugin-dts:options')

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
