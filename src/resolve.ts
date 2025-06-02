import path from 'node:path'
import { createResolver } from 'dts-resolver'
import { ResolverFactory } from 'rolldown/experimental'
import {
  filename_ts_to_dts,
  RE_CSS,
  RE_DTS,
  RE_NODE_MODULES,
  RE_TS,
  RE_VUE,
} from './filename.ts'
import type { OptionsResolved } from './index.ts'
import type { Plugin } from 'rolldown'

export function createDtsResolvePlugin({
  tsconfig,
  resolve,
}: Pick<OptionsResolved, 'tsconfig' | 'resolve'>): Plugin {
  const resolver = createResolver({
    tsconfig,
    resolveNodeModules: !!resolve,
    ResolverFactory,
  })

  return {
    name: 'rolldown-plugin-dts:resolve',

    resolveId: {
      order: 'pre',
      async handler(id, importer, options) {
        const external = { id, external: true, moduleSideEffects: false }
        // only resolve in dts file
        if (!importer || !RE_DTS.test(importer)) {
          return
        }

        if (RE_CSS.test(id)) {
          return {
            id,
            external: true,
            moduleSideEffects: false,
          }
        }

        let resolution = resolver(id, importer)
        resolution &&= path.normalize(resolution)
        if (
          !resolution ||
          (!RE_TS.test(resolution) && !RE_VUE.test(resolution))
        ) {
          const result = await this.resolve(id, importer, options)
          if (!result || !RE_TS.test(result.id)) {
            return external
          }
          resolution = result.id
        }

        if (
          !RE_NODE_MODULES.test(importer) &&
          RE_NODE_MODULES.test(resolution)
        ) {
          let shouldResolve: boolean
          if (typeof resolve === 'boolean') {
            shouldResolve = resolve
          } else {
            shouldResolve = resolve.some((pattern) =>
              typeof pattern === 'string' ? id === pattern : pattern.test(id),
            )
          }

          if (!shouldResolve) return external
        }

        if (
          (RE_TS.test(resolution) && !RE_DTS.test(resolution)) ||
          RE_VUE.test(resolution)
        ) {
          await this.load({ id: resolution })

          // redirect ts to dts
          resolution = filename_ts_to_dts(resolution)
        }

        if (RE_DTS.test(resolution)) {
          return resolution
        }
      },
    },
  }
}
