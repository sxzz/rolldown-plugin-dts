import { createDebug } from 'obug'
import { createDtsOnlyPlugin } from './dts-only.ts'
import { createFakeJsPlugin } from './fake-js/index.ts'
import { createGeneratePlugin } from './generate.ts'
import {
  resolveOptions,
  type Logger,
  type Options,
  type TscOptions,
} from './options.ts'
import { createDtsResolvePlugin } from './resolver.ts'
import type { Plugin } from 'rolldown'

const debug = createDebug('rolldown-plugin-dts:options')

export function dts(options: Options = {}): Plugin[] {
  debug('resolving dts options')
  const resolved = resolveOptions(options)
  debug('resolved dts options %o', resolved)

  return [
    resolved.dtsOnly && createDtsOnlyPlugin(resolved),
    createGeneratePlugin(resolved),
    createDtsResolvePlugin(resolved),
    createFakeJsPlugin(resolved),
  ].filter((plugin) => !!plugin)
}

export {
  createFakeJsPlugin,
  createGeneratePlugin,
  resolveOptions,
  type Logger,
  type Options,
  type TscOptions,
}
export type { CustomLanguage } from './custom-language.ts'
export type { Generator, GeneratorResult } from './generator/index.ts'
