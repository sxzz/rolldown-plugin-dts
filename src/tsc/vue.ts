import { createDebug } from 'obug'
import { require, requireTSApi } from '../require.ts'
import type { CustomLanguage } from '../custom-language.ts'
import type * as ts from 'typescript'

const debug = createDebug('rolldown-plugin-dts:vue')
const RE_VUE = /\.vue$/

export interface VueLanguageOptions {
  /** @ts-ignore - optional dep */
  vueCompilerOptions?: Partial<import('@vue/language-core').VueCompilerOptions>
}

export function createVueLanguageMetadata(): CustomLanguage {
  return {
    extensionPatterns: [RE_VUE],
    tsFileExtensionInfos: [
      {
        extension: 'vue',
        isMixedContent: true,
        scriptKind: 7 satisfies ts.ScriptKind.Deferred,
      },
    ],
    toTsFilename(id: string): string {
      return id.replace(RE_VUE, '.vue.ts')
    },
  }
}

export function createVueLanguage(
  userOptions: VueLanguageOptions = {},
): CustomLanguage {
  requireTSApi('Vue')

  const [volarTypeScript, vue] = loadVueLanguageTools()

  const getLanguagePlugin = (
    ts: typeof import('typescript'),
    options: import('typescript').CreateProgramOptions,
  ) => {
    const $rootDir = options.options.$rootDir as string
    const $configRaw = options.options.$configRaw as
      | (import('typescript').TsConfigSourceFile & { vueCompilerOptions?: any })
      | undefined

    const resolver = new vue.CompilerOptionsResolver(ts, ts.sys.readFile)
    const rawOptions = {
      ...$configRaw?.vueCompilerOptions,
      ...userOptions?.vueCompilerOptions,
    }
    resolver.addConfig(rawOptions, $rootDir)
    const vueOptions = resolver.build()

    return vue.createVueLanguagePlugin<string>(
      ts,
      options.options,
      vueOptions,
      (id) => id,
    )
  }

  return {
    ...createVueLanguageMetadata(),
    volarTypeScript,
    createVolarPlugins(ts, options) {
      return [getLanguagePlugin(ts, options)]
    },
  }
}

function loadVueLanguageTools(): [
  volarTs: typeof import('@volar/typescript'),
  vue: typeof import('@vue/language-core'),
] {
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
    return [volarTs, vue]
  } catch (cause) {
    debug('vue language tools not found', cause)
    throw new Error(
      'Failed to load Vue language tools. Please install `vue-tsc` manually.',
      { cause },
    )
  }
}
