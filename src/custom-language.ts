import type { Language, LanguagePlugin } from '@vue/language-core'
import type { FileExtensionInfo } from 'typescript'

/**
 * Describes a non-standard source language, such as Vue or Astro.
 *
 * If the language is supported via Volar, {@linkcode volarTypeScript} and
 * {@linkcode createVolarPlugins} must both be provided.
 */
export interface CustomLanguage {
  /** Patterns that identify files written in this language. */
  extensionPatterns: RegExp[]

  /** Extra file extensions passed to the TypeScript compiler. */
  tsFileExtensionInfos?: FileExtensionInfo[]

  /** Maps a source filename to the TypeScript filename used for declarations. */
  toTsFilename?: (id: string) => string

  /** @ts-ignore - optional dep */
  volarTypeScript?: typeof import('@volar/typescript')

  /** @ts-ignore - optional dep */
  createVolarPlugins?: Parameters<
    // @ts-ignore
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
