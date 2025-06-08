import { createRequire } from 'node:module'
import Debug from 'debug'
import type Ts from 'typescript'

const debug = Debug('rolldown-plugin-dts:vue')

let createVueProgram: typeof Ts.createProgram
const require = createRequire(import.meta.url)

function loadVueLanguageTools() {
  try {
    const vueTscPath = require.resolve('vue-tsc')
    const { proxyCreateProgram } = require(
      require.resolve('@volar/typescript', {
        paths: [vueTscPath],
      }),
    ) as typeof import('@volar/typescript')
    const vue = require(
      require.resolve('@vue/language-core', {
        paths: [vueTscPath],
      }),
    ) as typeof import('@vue/language-core')
    return { proxyCreateProgram, vue }
  } catch (error) {
    debug('vue language tools not found', error)
    throw new Error(
      'Failed to load vue language tools. Please manually install vue-tsc.',
    )
  }
}

// credits: https://github.com/vuejs/language-tools/blob/25f40ead59d862b3bd7011f2dd2968f47dfcf629/packages/tsc/index.ts
export function createVueProgramFactory(
  ts: typeof Ts,
): typeof Ts.createProgram {
  if (createVueProgram) return createVueProgram

  debug('loading vue language tools')
  const { proxyCreateProgram, vue } = loadVueLanguageTools()
  return (createVueProgram = proxyCreateProgram(
    ts,
    ts.createProgram,
    (ts, options) => {
      const { configFilePath } = options.options
      const vueOptions =
        typeof configFilePath === 'string'
          ? vue.createParsedCommandLine(
              ts,
              ts.sys,
              configFilePath.replaceAll('\\', '/'),
            ).vueOptions
          : vue.getDefaultCompilerOptions()
      const vueLanguagePlugin = vue.createVueLanguagePlugin<string>(
        ts,
        options.options,
        vueOptions,
        (id) => id,
      )
      return { languagePlugins: [vueLanguagePlugin] }
    },
  ))
}
