/* eslint-disable @typescript-eslint/no-require-imports */
import { createDebug } from 'obug'
import type { TscOptions } from './types.ts'
import type Ts from 'typescript'

const debug = createDebug('rolldown-plugin-dts:volar')

export function loadVueLanguageTools(): {
  volarTs: typeof import('@volar/typescript')
  vue: typeof import('@vue/language-core')
} {
  debug('loading vue language tools')
  try {
    const vueTscPath = require.resolve('vue-tsc')
    const volarTs = require(
      require.resolve('@volar/typescript', {
        paths: [vueTscPath],
      }),
    ) as typeof import('@volar/typescript')
    const vue = require(
      require.resolve('@vue/language-core', {
        paths: [vueTscPath],
      }),
    ) as typeof import('@vue/language-core')
    return { volarTs, vue }
  } catch (error) {
    debug('vue language tools not found', error)
    throw new Error(
      'Failed to load vue language tools. Please manually install vue-tsc.',
    )
  }
}

function initVueLanguageTools() {
  const {
    vue,
    volarTs: { proxyCreateProgram },
  } = loadVueLanguageTools()

  const getLanguagePlugin = (
    ts: typeof Ts,
    options: Ts.CreateProgramOptions,
  ) => {
    const $rootDir = options.options.$rootDir as string
    const $configRaw = options.options.$configRaw as
      | (Ts.TsConfigSourceFile & { vueCompilerOptions?: any })
      | undefined

    const resolver = new vue.CompilerOptionsResolver(ts, ts.sys.readFile)
    resolver.addConfig($configRaw?.vueCompilerOptions ?? {}, $rootDir)
    const vueOptions = resolver.build()

    return vue.createVueLanguagePlugin<string>(
      ts,
      options.options,
      vueOptions,
      (id) => id,
    )
  }
  return { proxyCreateProgram, getLanguagePlugin }
}

function initTsMacro() {
  const debug = createDebug('rolldown-plugin-dts:ts-macro')
  debug('loading ts-macro language tools')
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
    const getLanguagePlugin = (
      ts: typeof Ts,
      options: Ts.CreateProgramOptions,
    ) => {
      const $rootDir = options.options.$rootDir as string
      const tsMacroLanguagePlugins = tsMacro.getLanguagePlugins(
        ts,
        options.options,
        getOptions(ts, $rootDir),
      )
      return tsMacroLanguagePlugins[0]
    }
    return { proxyCreateProgram, getLanguagePlugin }
  } catch (error) {
    debug('ts-macro language tools not found', error)
    throw new Error(
      'Failed to load ts-macro language tools. Please manually install @ts-macro/tsc.',
    )
  }
}

// credits: https://github.com/vuejs/language-tools/blob/25f40ead59d862b3bd7011f2dd2968f47dfcf629/packages/tsc/index.ts
export function createProgramFactory(
  ts: typeof Ts,
  options: Pick<TscOptions, 'vue' | 'tsMacro'>,
): typeof Ts.createProgram {
  const vueLanguageTools = options.vue ? initVueLanguageTools() : undefined
  const tsMacroLanguageTools = options.tsMacro ? initTsMacro() : undefined
  const proxyCreateProgram =
    vueLanguageTools?.proxyCreateProgram ||
    tsMacroLanguageTools?.proxyCreateProgram
  if (!proxyCreateProgram) return ts.createProgram

  return proxyCreateProgram(ts, ts.createProgram, (ts, options) => {
    const languagePlugins = []
    if (vueLanguageTools) {
      languagePlugins.push(vueLanguageTools.getLanguagePlugin(ts, options))
    }
    if (tsMacroLanguageTools) {
      languagePlugins.push(tsMacroLanguageTools.getLanguagePlugin(ts, options))
    }
    return { languagePlugins }
  })
}
