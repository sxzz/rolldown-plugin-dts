import path from 'node:path'
import { createResolver } from 'dts-resolver'
import { ResolverFactory } from 'rolldown/experimental'
import {
  filename_to_dts,
  RE_CSS,
  RE_DTS,
  RE_NODE_MODULES,
  RE_TS,
  RE_VUE,
} from './filename.ts'
import type { OptionsResolved } from './options.ts'
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
    name: 'rolldown-plugin-dts:resolver',

    // Resolution algorithm
    //
    // 1. If no importer or not a dts file, skip to next plugin
    // 2. If css, externalize
    // 3. Resolve with rolldown's resolver
    // 4. Resolve with dts-resolver
    // 5. If dts resolution is a type file
    //    1. If rolldown resolution is not a type file, externalize
    //    2. Use rolldown resolution
    // 6. If dts resolution is from node_modules
    //    1. get shouldResolve from options.resolve
    //    2. If shouldResolve is false
    //       1. If importer is from node_modules
    //          1. If rolldown resolution is external, externalize
    //          2. Otherwise, continue resolving (even shouldResolve is false)
    //       2. Otherwise, externalize (from user code)
    // 7. If dts resolution is a TS file or vue file
    //    1. Load the file
    //    2. Redirect to corresponding dts file
    // 8. Ensure dts resolution is a dts file, return it

    resolveId: {
      order: 'pre',
      async handler(id, importer, options) {
        const external = { id, external: true, moduleSideEffects: false }

        // 1. Only resolve in dts file
        if (!importer || !RE_DTS.test(importer)) {
          return
        }

        // 2. If css, externalize
        if (RE_CSS.test(id)) {
          return external
        }

        // 3. Resolve with rolldown's resolver
        const rolldownResolution = await this.resolve(id, importer, options)

        // 4. Resolve with dts-resolver
        let dtsResolution = resolver(id, importer)
        dtsResolution &&= path.normalize(dtsResolution)

        // 5. If dts resolution is not a TS/Vue file
        if (
          !dtsResolution ||
          (!RE_TS.test(dtsResolution) && !RE_VUE.test(dtsResolution))
        ) {
          if (
            !rolldownResolution ||
            (!RE_TS.test(rolldownResolution.id) &&
              !RE_VUE.test(rolldownResolution.id))
          ) {
            return external
          }
          dtsResolution = rolldownResolution.id
        }

        // 6. If dts resolution is from node_modules
        if (RE_NODE_MODULES.test(dtsResolution)) {
          let shouldResolve: boolean
          if (typeof resolve === 'boolean') {
            shouldResolve = resolve
          } else {
            shouldResolve = resolve.some((pattern) =>
              typeof pattern === 'string' ? id === pattern : pattern.test(id),
            )
          }
          if (!shouldResolve) {
            if (RE_NODE_MODULES.test(importer)) {
              // from node_modules
              if (rolldownResolution?.external) {
                return external
              }
            } else {
              // from user code
              return external
            }
          }
        }

        // 7. If dts resolution is a TS file or vue file
        if (
          (RE_TS.test(dtsResolution) && !RE_DTS.test(dtsResolution)) ||
          RE_VUE.test(dtsResolution)
        ) {
          await this.load({ id: dtsResolution })
          // redirect ts to dts
          dtsResolution = filename_to_dts(dtsResolution)
        }

        // 8. Ensure dts resolution is a dts file, return it
        if (RE_DTS.test(dtsResolution)) {
          return dtsResolution
        }
      },
    },
  }
}
