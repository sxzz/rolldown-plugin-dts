import {
  isolatedDeclarationSync,
  type IsolatedDeclarationsOptions,
} from 'rolldown/experimental'
import type { LanguageContext } from '../custom-language.ts'
import type { Generator, GeneratorResult } from './index.ts'
import type { SourceMapInput } from 'rolldown'

export class OxcGenerator implements Generator {
  private options: IsolatedDeclarationsOptions
  private languageContext: LanguageContext

  constructor(
    options: IsolatedDeclarationsOptions,
    languageContext: LanguageContext,
  ) {
    this.options = options
    this.languageContext = languageContext
  }

  emit(code: string, fileName: string): GeneratorResult {
    // Volar-based custom languages force the `tsc` generator, so any custom
    // language file reaching here is plain TS with a custom extension; map the
    // filename so oxc parses it as TS.
    const result = isolatedDeclarationSync(
      this.languageContext.toTsFilename(fileName),
      code,
      this.options,
    )
    if (result.errors.length) {
      const [error] = result.errors
      return {
        error: {
          message: error.message,
          frame: error.codeframe || undefined,
        },
      }
    }

    let map: SourceMapInput | undefined
    if (result.map) {
      map = result.map
      // Point back to the original file, not the mapped TS filename.
      map.sources = [fileName]
      map.sourcesContent = undefined
    }

    return { code: result.code, map }
  }
}
