import MagicString from 'magic-string'
import { RE_DTS } from './filename.ts'
import type { OptionsResolved } from './options.ts'
import type { Plugin } from 'rolldown'

export function createBannerPlugin({
  banner,
  footer,
}: Pick<OptionsResolved, 'banner' | 'footer'>): Plugin {
  return {
    name: 'rolldown-plugin-dts:banner',
    async renderChunk(code: string, chunk) {
      if (!RE_DTS.test(chunk.fileName)) {
        return
      }

      const s = new MagicString(code)
      if (banner) {
        const code = await (typeof banner === 'function'
          ? banner(chunk)
          : banner)
        if (code) s.prepend(`${code}\n`)
      }
      if (footer) {
        const code = await (typeof footer === 'function'
          ? footer(chunk)
          : footer)
        if (code) s.append(`\n${code}`)
      }

      return {
        code: s.toString(),
        get map() {
          return s.generateMap({
            source: chunk.fileName,
            includeContent: true,
            hires: 'boundary',
          })
        },
      }
    },
  }
}
