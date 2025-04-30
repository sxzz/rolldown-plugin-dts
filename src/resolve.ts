import { createResolver } from 'dts-resolver'
import {
  filename_js_to_dts,
  filename_ts_to_dts,
  isRelative,
  RE_CSS,
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
  resolvePaths,
}: Pick<OptionsResolved, 'tsconfig' | 'resolve' | 'resolvePaths'>): Plugin {
  const resolver = createResolver({
    tsconfig: tsconfig ? (tsconfig as string) : undefined,
  })

  function resolveDependency(id: string, importer: string) {
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

        if (RE_CSS.test(id)) {
          return {
            id,
            external: true,
            moduleSideEffects: false,
          }
        }

        if (RE_NODE_MODULES.test(importer)) {
          const resolution = resolver(id, importer)
          if (resolution) return { id: resolution, meta }
        }

        // resolve dependency [pre]
        if (!resolvePaths && (RE_NODE_MODULES.test(id) || !isRelative(id))) {
          return resolveDependency(id, importer)
        }

        let resolution = await this.resolve(id, importer, options)
        if (!resolution && !id.endsWith('.d')) {
          resolution = await this.resolve(`${id}.d`, importer, options)
        }

        if (resolution?.id) {
          if (RE_CSS.test(resolution.id)) {
            return {
              id,
              external: true,
              moduleSideEffects: false,
            }
          }
          if (resolution.id.startsWith('\0')) {
            return { ...resolution, meta }
          }
        }

        // resolve dependency [post]
        if (
          resolvePaths &&
          (RE_NODE_MODULES.test(resolution?.id || id) ||
            !isRelative(resolution?.id || id))
        ) {
          return resolveDependency(id, importer)
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
          // FIXME: rolldown bug
          await Promise.any([
            this.load(resolution),
            new Promise((resolve) => setTimeout(resolve, 200)),
          ])

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
