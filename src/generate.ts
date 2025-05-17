import { fork, type ChildProcess } from 'node:child_process'
import { createBirpc, type BirpcReturn } from 'birpc'
import Debug from 'debug'
import { isolatedDeclaration as oxcIsolatedDeclaration } from 'rolldown/experimental'
import {
  filename_ts_to_dts,
  RE_DTS,
  RE_DTS_MAP,
  RE_JS,
  RE_NODE_MODULES,
  RE_TS,
  RE_VUE,
} from './utils/filename.ts'
import type { TscFunctions } from './utils/tsc-worker.ts'
import type { TscOptions, TscResult } from './utils/tsc.ts'
import type { OptionsResolved } from './index.ts'
import type { Plugin } from 'rolldown'
import type ts from 'typescript'

const debug = Debug('rolldown-plugin-dts:generate')

const WORKER_URL = import.meta.WORKER_URL || './utils/tsc-worker.ts'

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
  compilerOptions,
  references,
  isolatedDeclarations,
  emitDtsOnly,
  vue,
  parallel,
}: Pick<
  OptionsResolved,
  | 'compilerOptions'
  | 'references'
  | 'isolatedDeclarations'
  | 'emitDtsOnly'
  | 'vue'
  | 'parallel'
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

  let programs: ts.Program[] = []
  let childProcess: ChildProcess | undefined
  let rpc: BirpcReturn<TscFunctions> | undefined
  let tscEmit: (options: TscOptions) => TscResult

  if (parallel) {
    childProcess = fork(new URL(WORKER_URL, import.meta.url), {
      stdio: 'inherit',
    })
    rpc = createBirpc<TscFunctions>(
      {},
      {
        post: (data) => childProcess!.send(data),
        on: (fn) => childProcess!.on('message', fn),
      },
    )
  }

  return {
    name: 'rolldown-plugin-dts:generate',

    async buildStart(options) {
      if (!parallel && (!isolatedDeclarations || vue)) {
        ;({ tscEmit } = await import('./utils/tsc.ts'))
      }

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
        debug('resolve dts id %s', id)
        return { id }
      }
    },

    transform: {
      order: 'pre',
      filter: {
        id: {
          include: [RE_TS, RE_VUE],
          exclude: [RE_DTS, RE_NODE_MODULES],
        },
      },
      handler(code, id) {
        const mod = this.getModuleInfo(id)
        const isEntry = !!mod?.isEntry
        const dtsId = filename_ts_to_dts(id)
        dtsMap.set(dtsId, { code, id, isEntry })
        debug('register dts source: %s', id)

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
      async handler(dtsId) {
        if (!dtsMap.has(dtsId)) return

        const { code, id, isEntry } = dtsMap.get(dtsId)!
        let dtsCode: string | undefined
        let map: any
        debug('generate dts %s from %s', dtsId, id)

        if (isolatedDeclarations && !RE_VUE.test(id)) {
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
            map.sourcesContent = undefined
          }
        } else {
          const options: Omit<TscOptions, 'programs'> = {
            compilerOptions,
            references,
            id,
            isEntry,
            dtsMap: Array.from(dtsMap.entries()),
            vue,
          }
          let result: TscResult
          if (parallel) {
            result = await rpc!.emit(options)
          } else {
            result = tscEmit({
              ...options,
              programs,
            })
          }
          if (result.error) {
            return this.error(result.error)
          }
          dtsCode = result.code
          map = result.map
        }

        return {
          code: dtsCode || '',
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
      childProcess?.kill()
      programs = []
    },
  }
}
