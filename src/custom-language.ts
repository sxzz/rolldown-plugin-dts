import type { Language, LanguagePlugin } from '@vue/language-core'
import type { FileExtensionInfo } from 'typescript'

/**
 * A custom language (such as Vue or Astro) that allows the `tsc` generator to
 * process non-standard file types when generating `.d.ts` files.
 *
 * If the language is supported via Volar, {@linkcode volarTypeScript} and
 * {@linkcode createVolarPlugins} must both be provided.
 */
export interface CustomLanguage {
  extensionPatterns: RegExp[]
  tsFileExtensionInfos?: FileExtensionInfo[]
  toTsFilename?: (id: string) => string

  /**
   * The contents of the `@volar/typescript` package.
   *
   * If the language is supported via Volar, this must be provided together
   * with {@linkcode createVolarPlugins}.
   */
  volarTypeScript?: typeof import('@volar/typescript')
  /**
   * Creates the Volar language plugins for this language.
   *
   * If the language is supported via Volar, this must be provided together
   * with {@linkcode volarTypeScript}.
   */
  createVolarPlugins?: Parameters<
    (typeof import('@volar/typescript'))['proxyCreateProgram']
  >[2]
}

export class LanguageContext {
  languages: CustomLanguage[]
  patterns: RegExp[]

  constructor(languages: CustomLanguage[]) {
    this.languages = languages
    this.patterns = languages.flatMap((language) => language.extensionPatterns)
  }

  isCustomLanguageFile(id: string): boolean {
    return this.patterns.some((pattern) => pattern.test(id))
  }

  isUsingVolar(): boolean {
    return this.languages.some(
      (language) => language.volarTypeScript || language.createVolarPlugins,
    )
  }

  getExtraFileExtensions(): FileExtensionInfo[] | undefined {
    if (!this.languages.length) return
    return this.languages.flatMap(
      (language) => language.tsFileExtensionInfos || [],
    )
  }

  getCreateProgram(
    ts: typeof import('typescript'),
  ): typeof import('typescript').createProgram {
    if (!this.languages.length) return ts.createProgram

    const volarTypeScript = this.languages.find(
      (language) => language.volarTypeScript,
    )?.volarTypeScript
    if (!volarTypeScript) {
      return ts.createProgram
    }

    const { proxyCreateProgram } = volarTypeScript
    return proxyCreateProgram(ts, ts.createProgram, (ts, options) => {
      const setups: ((language: Language<string>) => void)[] = []
      const plugins: LanguagePlugin[] = []

      for (const language of this.languages) {
        if (!language.createVolarPlugins) continue
        const result = language.createVolarPlugins(ts, options)
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
    for (const language of this.languages) {
      if (
        language.toTsFilename &&
        language.extensionPatterns.some((pattern) => pattern.test(id))
      ) {
        return language.toTsFilename(id)
      }
    }
    return id
  }
}
