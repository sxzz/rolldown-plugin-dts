import Debug from 'debug'
import { isolatedDeclaration as oxcIsolatedDeclaration } from 'oxc-transform'
import {
  filename_ts_to_dts,
  RE_DTS,
  RE_DTS_MAP,
  RE_JS,
  RE_NODE_MODULES,
  RE_TS,
} from './utils/filename'
import { createOrGetTsModule, initTs, tscEmit } from './utils/tsc'
import type { OptionsResolved } from '.'
import type { Plugin } from 'rolldown'
import type * as Ts from 'typescript'

const debug = Debug('rolldown-plugin-dts:generate')

export interface TsModule {
  /** `.ts` source code */
  code: string
  /** `.ts` file name */
  id: string
  isEntry: boolean
}
/** dts filename -> ts module */
export type DtsMap = Map<string, TsModule>

export function createGeneratePlugin({
  compilerOptions = {},
  isolatedDeclarations,
  emitDtsOnly = false,
}: Pick<
  OptionsResolved,
  'compilerOptions' | 'isolatedDeclarations' | 'emitDtsOnly'
>): Plugin {
  const dtsMap: DtsMap = new Map<string, TsModule>()

  /**
   * A map of input id to output file name
   *
   * @example
   *
   * inputAlias = new Map([
   *   ['/absolute/path/to/src/source_file.ts', 'dist/foo/index'],
   * ])
   */
  const inputAliasMap = new Map<string, string>()
  let programs: Ts.Program[] = []

  if (!isolatedDeclarations) {
    initTs()
  }

  return {
    name: 'rolldown-plugin-dts:generate',

    async buildStart(options) {
      if (!Array.isArray(options.input)) {
        for (const [name, id] of Object.entries(options.input)) {
          debug('resolving input alias %s -> %s', name, id)
          let resolved = await this.resolve(id)
          if (!id.startsWith('./')) {
            resolved ||= await this.resolve(`./${id}`)
          }
          const resolvedId = resolved?.id || id
          debug('resolved input alias %s -> %s', id, resolvedId)
          inputAliasMap.set(resolvedId, name)
        }
      }
    },

    outputOptions(options) {
      return {
        ...options,
        entryFileNames(chunk) {
          const original =
            (typeof options.entryFileNames === 'function'
              ? options.entryFileNames(chunk)
              : options.entryFileNames) || '[name].js'
          if (!original.includes('.d') && chunk.name.endsWith('.d')) {
            return original.replace(RE_JS, '.$1ts')
          }
          return original
        },
      }
    },

    resolveId(id) {
      if (dtsMap.has(id)) {
        return { id }
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
        const mod = this.getModuleInfo(id)
        const isEntry = !!mod?.isEntry
        const dtsId = filename_ts_to_dts(id)
        dtsMap.set(dtsId, { code, id, isEntry })

        if (isEntry) {
          const name = inputAliasMap.get(id)
          this.emitFile({
            type: 'chunk',
            id: dtsId,
            name: name ? `${name}.d` : undefined,
          })
        }

        if (emitDtsOnly) {
          return 'export { }'
        }
      },
    },

    load: {
      filter: {
        id: {
          include: [RE_DTS],
          exclude: [RE_NODE_MODULES],
        },
      },
      handler(dtsId) {
        if (!dtsMap.has(dtsId)) return

        const { code, id, isEntry } = dtsMap.get(dtsId)!
        let dtsCode: string | undefined
        let map: any

        if (isolatedDeclarations) {
          const result = oxcIsolatedDeclaration(id, code, isolatedDeclarations)
          if (result.errors.length) {
            const [error] = result.errors
            return this.error({
              message: error.message,
              frame: error.codeframe,
            })
          }
          dtsCode = result.code
          if (result.map) {
            map = result.map
            // map.sourcesContent = undefined
          }
        } else {
          const module = createOrGetTsModule(
            programs,
            compilerOptions,
            id,
            isEntry,
            dtsMap,
          )
          const result = tscEmit(module)
          if (result.error) {
            return this.error(result.error)
          }
          dtsCode = result.code
          map = result.map
        }

        if (!dtsCode) {
          return this.error(new Error(`Failed to generate dts for ${id}`))
        }

        return {
          code: dtsCode,
          moduleSideEffects: false,
          map,
        }
      },
    },

    generateBundle: emitDtsOnly
      ? (options, bundle) => {
          for (const fileName of Object.keys(bundle)) {
            if (
              bundle[fileName].type === 'chunk' &&
              !RE_DTS.test(fileName) &&
              !RE_DTS_MAP.test(fileName)
            ) {
              delete bundle[fileName]
            }
          }
        }
      : undefined,

    buildEnd() {
      programs = []
    },
  }
}
