/* eslint-disable @typescript-eslint/no-require-imports */
import { createDebug } from 'obug'
import type { TscOptions } from './types.ts'
import type Ts from 'typescript'

const debug = createDebug('rolldown-plugin-dts:volar')

/**
 * Dynamically loads
 * {@linkcode https://github.com/volarjs/volar.js/tree/master/packages/typescript | @volar/typescript}
 * and
 * {@linkcode https://github.com/vuejs/language-tools/tree/HEAD/packages/language-core | @vue/language-core}
 * from the
 * {@linkcode https://github.com/vuejs/language-tools/tree/HEAD/packages/tsc | vue-tsc}
 * installation in `node_modules`.
 *
 * @returns An object containing the loaded `volarTs` and `vue` modules.
 * @throws An {@linkcode Error} if {@linkcode https://github.com/vuejs/language-tools/tree/HEAD/packages/tsc | vue-tsc} is not installed or cannot be resolved.
 */
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
      { cause: error },
    )
  }
}

/**
 * Initializes the Vue language tools by calling
 * {@linkcode loadVueLanguageTools | loadVueLanguageTools()} and building a
 * `getLanguagePlugin` factory that creates a Vue language plugin for the given
 * {@linkcode Ts.CreateProgramOptions | TypeScript program options}.
 *
 * @returns An object with `proxyCreateProgram` and `getLanguagePlugin`.
 */
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

/**
 * Initializes the ts-macro language tools, loading
 * {@linkcode https://github.com/ts-macro/ts-macro/tree/HEAD/packages/language-plugin | @ts-macro/language-plugin}
 * and `@ts-macro/language-plugin/options` from the
 * {@linkcode https://github.com/ts-macro/ts-macro/tree/main/packages/tsc | @ts-macro/tsc}
 * installation.
 *
 * @returns An object with `proxyCreateProgram` and `getLanguagePlugin`.
 * @throws An {@linkcode Error} if {@linkcode https://github.com/ts-macro/ts-macro/tree/main/packages/tsc | @ts-macro/tsc} is not installed or cannot be resolved.
 */
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
      { cause: error },
    )
  }
}

/**
 * Returns a patched {@linkcode Ts.createProgram | createProgram()} factory
 * that injects Vue or ts-macro language plugins, enabling
 * {@linkcode https://github.com/vuejs/language-tools/tree/HEAD/packages/tsc | vue-tsc}
 * and
 * {@linkcode https://github.com/ts-macro/ts-macro/tree/main/packages/tsc | @ts-macro/tsc}
 * semantics during declaration emit.
 *
 * @param ts - The TypeScript module instance to wrap.
 * @param options - Controls which language plugins to activate.
 * @returns A drop-in replacement for {@linkcode Ts.createProgram | createProgram()} with the appropriate language plugins applied, or the unpatched {@linkcode Ts.createProgram | createProgram()} if neither {@linkcode TscOptions.vue | vue} nor {@linkcode TscOptions.tsMacro | tsMacro} is enabled.
 *
 * @see {@link https://github.com/vuejs/language-tools/blob/25f40ead59d862b3bd7011f2dd2968f47dfcf629/packages/tsc/index.ts | Volar's `createProgram` patch} for more details on how the patching works.
 */
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
