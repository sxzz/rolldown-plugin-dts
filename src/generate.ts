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
}: Pick<Options, 'external' | 'isolatedDeclaration' | 'inputAlias'>): Plugin {
  const dtsMap = new Map<string, string>()
  const inputAliasMap = new Map<string, string>(
    Object.entries(inputAlias || {}),
  )

  let inputOption: Record<string, string> | undefined

  return {
    name: 'rolldown-plugin-dts:generate',

    options({ input }) {
      if (isPlainObject(input)) {
        inputOption = { ...input }
      }
    },

    transform: {
      order: 'pre',
      filter: {
        id: {
          include: [RE_TS],
          exclude: [RE_DTS, RE_NODE_MODULES],
        },
      },
      handler(code, id) {
        const { code: dtsCode, errors } = oxcIsolatedDeclaration(
          id,
          code,
          isolatedDeclaration,
        )
        if (errors.length) {
          return this.error(errors[0])
        }

        const dtsId = filename_ts_to_dts(id)
        dtsMap.set(dtsId, dtsCode)

        const mod = this.getModuleInfo(id)
        if (mod?.isEntry) {
          let fileName = basename(dtsId)

          if (inputAliasMap.has(dtsId)) {
            fileName = inputAliasMap.get(dtsId)!
          }
          if (inputAliasMap.has(fileName)) {
            fileName = inputAliasMap.get(fileName)!
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

      if (importer && this.getModuleInfo(importer)?.meta.dtsFile) {
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
      } else if (extraOptions.isEntry && inputOption) {
        // mapping entry point to dts filename
        const resolution = await this.resolve(id, importer, extraOptions)
        if (!resolution) return

        const dtsId = filename_ts_to_dts(resolution.id)
        if (inputAliasMap.has(dtsId)) return resolution

        for (const [name, entry] of Object.entries(inputOption)) {
          if (entry === id) {
            inputAliasMap.set(dtsId, `${name}.d.ts`)
            break
          }
        }

        return resolution
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

function isPlainObject(data: unknown): data is Record<PropertyKey, unknown> {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  const proto = Object.getPrototypeOf(data)
  return proto === null || proto === Object.prototype
}
