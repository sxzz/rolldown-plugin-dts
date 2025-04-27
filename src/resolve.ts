import { createResolver } from 'dts-resolver'
import {
  filename_js_to_dts,
  filename_ts_to_dts,
  isRelative,
  RE_DTS,
  RE_JS,
  RE_NODE_MODULES,
  RE_TS,
} from './utils/filename'
import type { OptionsResolved } from '.'
import type { Plugin } from 'rolldown'

export const meta = { dtsFile: true } as const

export function createDtsResolvePlugin({
  tsconfig,
  resolve,
}: Pick<OptionsResolved, 'tsconfig' | 'resolve'>): Plugin {
  const resolver = createResolver({
    tsconfig: tsconfig ? (tsconfig as string) : undefined,
  })

  return {
    name: 'rolldown-plugin-dts:resolve',

    resolveId: {
      order: 'pre',
      async handler(id, importer, options) {
        // only resolve in dts file
        if (
          !importer ||
          (!RE_DTS.test(importer) &&
            !this.getModuleInfo(importer)?.meta.dtsFile)
        ) {
          return
        }

        if (RE_NODE_MODULES.test(importer)) {
          const resolution = resolver(id, importer)
          if (resolution) return { id: resolution, meta }
        }

        // link to the original module
        let resolution = await this.resolve(id, importer, options)
        if (!resolution && !id.endsWith('.d')) {
          resolution = await this.resolve(`${id}.d`, importer, options)
        }

        // resolve dependency
        if (
          RE_NODE_MODULES.test(resolution?.id || id) ||
          !isRelative(resolution?.id || id)
        ) {
          let shouldResolve: boolean
          if (typeof resolve === 'boolean') {
            shouldResolve = resolve
          } else {
            shouldResolve = resolve.some((pattern) =>
              typeof pattern === 'string' ? id === pattern : pattern.test(id),
            )
          }
          if (shouldResolve) {
            const resolution = resolver(id, importer)
            if (resolution) return { id: resolution, meta }
          } else {
            return { id, external: true, meta }
          }
        }

        if (!resolution || resolution.external) {
          return resolution
        }

        if (RE_JS.test(resolution.id)) {
          // resolve js to dts
          resolution = await this.resolve(
            filename_js_to_dts(resolution.id),
            importer,
            options,
          )
          if (!resolution) return
        } else if (RE_TS.test(resolution.id) && !RE_DTS.test(resolution.id)) {
          // module is not loaded yet
          if (!this.getModuleInfo(resolution.id)) {
            await this.load(resolution)
          }

          // redirect ts to dts
          resolution.id = filename_ts_to_dts(resolution.id)
        }

        if (RE_DTS.test(resolution.id)) {
          return { ...resolution, meta }
        }
      },
    },
  }
}
