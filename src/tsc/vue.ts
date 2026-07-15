/* eslint-disable @typescript-eslint/no-require-imports */
import { createDebug } from 'obug'
import { requireTS } from '../utils.ts'
import type { VolarPlugin } from '../volar.ts'

const debug = createDebug('rolldown-plugin-dts:vue')
const RE_VUE = /\.vue$/

export function getVueVolarPlugin(): VolarPlugin {
  const ts = requireTS(
    `Vue support requires TypeScript to be installed. Please install \`typescript\` package.`,
  )

  const [{ proxyCreateProgram }, vue] = loadVueLanguageTools()

  const getLanguagePlugin = (
    ts: typeof import('typescript'),
    options: import('typescript').CreateProgramOptions,
  ) => {
    const $rootDir = options.options.$rootDir as string
    const $configRaw = options.options.$configRaw as
      | (import('typescript').TsConfigSourceFile & { vueCompilerOptions?: any })
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

  return {
    extensions: [
      {
        pattern: RE_VUE,
        tsFileExtensionInfo: {
          extension: 'vue',
          isMixedContent: true,
          scriptKind: ts.ScriptKind.Deferred,
        },
      },
    ],
    toTsFilename(id: string): string {
      return id.replace(RE_VUE, '.vue.ts')
    },
    getCreateProgram() {
      return proxyCreateProgram(ts, ts.createProgram, (ts, options) => {
        return {
          languagePlugins: [getLanguagePlugin(ts, options)],
        }
      })
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
  } catch (error) {
    debug('vue language tools not found', error)
    throw new Error(
      'Failed to load vue language tools. Please manually install vue-tsc.',
      { cause: error },
    )
  }
}
