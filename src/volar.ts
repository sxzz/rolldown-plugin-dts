import type { Language, LanguagePlugin } from '@vue/language-core'
import type { FileExtensionInfo } from 'typescript'

export interface VolarPlugin {
  extensionPatterns: RegExp[]
  tsFileExtensionInfos?: FileExtensionInfo[]
  volarTypeScript?: typeof import('@volar/typescript')
  create?: Parameters<
    (typeof import('@volar/typescript'))['proxyCreateProgram']
  >[2]
  toTsFilename?: (id: string) => string
}

export class VolarContext {
  plugins: VolarPlugin[]
  patterns: RegExp[]

  constructor(plugins: VolarPlugin[]) {
    this.plugins = plugins
    this.patterns = plugins.flatMap((plugin) => plugin.extensionPatterns)
  }

  isVolarFile(id: string): boolean {
    return this.patterns.some((pattern) => pattern.test(id))
  }

  getExtraFileExtensions(): FileExtensionInfo[] | undefined {
    if (!this.plugins.length) return
    return this.plugins.flatMap((plugin) => plugin.tsFileExtensionInfos || [])
  }

  getCreateProgram(
    ts: typeof import('typescript'),
  ): typeof import('typescript').createProgram {
    if (!this.plugins.length) return ts.createProgram

    const volarTypeScript = this.plugins.find(
      (plugin) => plugin.volarTypeScript,
    )?.volarTypeScript
    if (!volarTypeScript) {
      return ts.createProgram
    }

    const { proxyCreateProgram } = volarTypeScript
    return proxyCreateProgram(ts, ts.createProgram, (ts, options) => {
      const setups: ((language: Language<string>) => void)[] = []
      const plugins: LanguagePlugin[] = []

      for (const plugin of this.plugins) {
        if (!plugin.create) continue
        const result = plugin.create(ts, options)
        if (Array.isArray(result)) {
          plugins.push(...result)
        } else {
          if (result.setup) setups.push(result.setup)
          plugins.push(...result.languagePlugins)
        }
      }

      const setup = setups.length
        ? (language: Language<string>) => {
            for (const setup of setups) {
              setup(language)
            }
          }
        : undefined

      return { setup, languagePlugins: plugins }
    })
  }

  toTsFilename(id: string): string {
    for (const plugin of this.plugins) {
      if (
        plugin.toTsFilename &&
        plugin.extensionPatterns.some((pattern) => pattern.test(id))
      ) {
        return plugin.toTsFilename(id)
      }
    }
    return id
  }
}
