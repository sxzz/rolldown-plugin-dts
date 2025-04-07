import { basename } from 'node:path'
import { isolatedDeclaration as oxcIsolatedDeclaration } from 'oxc-transform'
import {
  filename_dts_to,
  filename_ts_to_dts,
  isRelative,
  RE_DTS,
  RE_NODE_MODULES,
  RE_TS,
} from './utils/filename'
import type { Options } from '.'
import type { Plugin } from 'rolldown'

export function createGeneratePlugin({
  isolatedDeclaration,
  inputAlias,
  external,
}: Options): Plugin {
  const dtsMap = new Map<string, string>()

  return {
    name: 'rolldown-plugin-dts:generate',

    transform: {
      order: 'pre',
      filter: {
        id: {
          include: [RE_TS],
          exclude: [RE_DTS, RE_NODE_MODULES],
        },
      },
      handler(code, id) {
        const result = oxcIsolatedDeclaration(id, code, isolatedDeclaration)
        const dtsId = filename_ts_to_dts(id)
        dtsMap.set(dtsId, result.code)

        const mod = this.getModuleInfo(id)
        if (mod?.isEntry) {
          let fileName = basename(dtsId)
          if (inputAlias?.[fileName]) {
            fileName = inputAlias[fileName]
          }
          this.emitFile({
            type: 'chunk',
            id: dtsId,
            fileName,
          })
        }
      },
    },

    async resolveId(id, importer, extraOptions) {
      // must be entry
      if (dtsMap.has(id)) {
        return { id, meta: { dtsFile: true } }
      }

      const importerMod = importer ? this.getModuleInfo(importer) : null
      if (importerMod?.meta.dtsFile) {
        if (
          // FIXME external all deps temporarily
          // should introduce custom resolver for resolving types from node_modules
          !isRelative(id) ||
          external?.(id, importer!, extraOptions) === true
        ) {
          return { id, external: true }
        }

        // link to the original module
        const resolution = await this.resolve(
          id,
          filename_dts_to(importer!, 'ts'),
        )
        if (!resolution || resolution.external) return

        const dtsId = filename_ts_to_dts(resolution.id)
        if (dtsMap.has(dtsId)) {
          return { id: dtsId, meta: { dtsFile: true } }
        }

        // pre-load original module if not already loaded
        await this.load(resolution)
        if (dtsMap.has(dtsId)) {
          return { id: dtsId, meta: { dtsFile: true } }
        }
      }
    },

    load: {
      filter: {
        id: {
          include: [RE_DTS],
          exclude: [RE_NODE_MODULES],
        },
      },
      handler(id) {
        if (dtsMap.has(id)) {
          return {
            code: dtsMap.get(id)!,
            moduleSideEffects: false,
          }
        }
      },
    },
  }
}
