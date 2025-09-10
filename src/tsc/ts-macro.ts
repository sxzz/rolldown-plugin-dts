import { createRequire } from 'node:module'
import Debug from 'debug'
import type Ts from 'typescript'

const debug = Debug('rolldown-plugin-dts:ts-macro')

let createTsMacroProgram: typeof Ts.createProgram
const require = createRequire(import.meta.url)

function loadTsMacroLanguageTools() {
  try {
    const tsMacroPath = require.resolve('@ts-macro/tsc')
    const { proxyCreateProgram } = require(
      require.resolve('@volar/typescript', {
        paths: [tsMacroPath],
      }),
    ) as typeof import('@volar/typescript')
    const tsMacro = require(
      require.resolve('@ts-macro/language-plugin', {
        paths: [tsMacroPath],
      }),
    )
    const { getOptions } = require(
      require.resolve('@ts-macro/language-plugin/options', {
        paths: [tsMacroPath],
      }),
    )
    return { proxyCreateProgram, tsMacro, getOptions }
  } catch (error) {
    debug('ts-macro language tools not found', error)
    throw new Error(
      'Failed to load ts-macro language tools. Please manually install @ts-macro/tsc.',
    )
  }
}

export function createTsMacroProgramFactory(
  ts: typeof Ts,
): typeof Ts.createProgram {
  if (createTsMacroProgram) return createTsMacroProgram

  debug('loading ts-macro language tools')
  const { proxyCreateProgram, tsMacro, getOptions } = loadTsMacroLanguageTools()
  return (createTsMacroProgram = proxyCreateProgram(
    ts,
    ts.createProgram,
    (ts, options) => {
      const tsMacroLanguagePlugins = tsMacro.getLanguagePlugins(
        ts,
        options.options,
        getOptions(ts),
      )
      return { languagePlugins: tsMacroLanguagePlugins }
    },
  ))
}
