import { createRequire } from 'node:module'
import { createDebug } from 'obug'
import { requireTS } from './load-tsc.ts'
import type { VolarPlugin } from '../volar.ts'

const require = createRequire(import.meta.url)
const debug = createDebug('rolldown-plugin-dts:vue')
const RE_VUE = /\.vue$/

export function getVueVolarPlugin(): VolarPlugin {
  const ts = requireTS(
    `Vue support requires TypeScript to be installed. Please install \`typescript\` package.`,
  )

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
    extensionPatterns: [RE_VUE],
    tsFileExtensionInfos: [
      {
        extension: 'vue',
        isMixedContent: true,
        scriptKind: ts.ScriptKind.Deferred,
      },
    ],
    volarTypeScript,
    create(ts, options) {
      return [getLanguagePlugin(ts, options)]
    },
    toTsFilename(id: string): string {
      return id.replace(RE_VUE, '.vue.ts')
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
    // eslint-disable-next-line unicorn/catch-error-name
  } catch (cause) {
    debug('vue language tools not found', cause)
    throw new Error(
      'Failed to load vue language tools. Please manually install vue-tsc.',
      { cause },
    )
  }
}
