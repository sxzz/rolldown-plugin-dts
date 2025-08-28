import { fork, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Debug from 'debug'
import { isolatedDeclaration as oxcIsolatedDeclaration } from 'rolldown/experimental'
import {
  filename_to_dts,
  RE_DTS,
  RE_DTS_MAP,
  RE_JS,
  RE_NODE_MODULES,
  RE_TS,
  RE_VUE,
} from './filename.ts'
import {
  createContext,
  globalContext,
  invalidateContextFile,
  type TscContext,
} from './tsc/context.ts'
import type { OptionsResolved } from './options.ts'
import type { TscOptions, TscResult } from './tsc/index.ts'
import type { TscFunctions } from './tsc/worker.ts'
import type { BirpcReturn } from 'birpc'
import type { Plugin, SourceMapInput } from 'rolldown'

const debug = Debug('rolldown-plugin-dts:generate')

const WORKER_URL = import.meta.WORKER_URL || './tsc/worker.ts'

const spawnAsync = (...args: Parameters<typeof spawn>) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(...args)
    child.on('close', () => resolve())
    child.on('error', (error) => reject(error))
  })

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
  tsconfig,
  tsconfigRaw,
  build,
  incremental,
  cwd,
  oxc,
  emitDtsOnly,
  vue,
  parallel,
  eager,
  tsgo,
  newContext,
  emitJs,
}: Pick<
  OptionsResolved,
  | 'cwd'
  | 'tsconfig'
  | 'tsconfigRaw'
  | 'build'
  | 'incremental'
  | 'oxc'
  | 'emitDtsOnly'
  | 'vue'
  | 'parallel'
  | 'eager'
  | 'tsgo'
  | 'newContext'
  | 'emitJs'
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

  // let isWatch = false
  let childProcess: ChildProcess | undefined
  let rpc: BirpcReturn<TscFunctions> | undefined
  let tscModule: typeof import('./tsc/index.ts')
  let tscContext: TscContext | undefined
  let tsgoDist: string | undefined

  return {
    name: 'rolldown-plugin-dts:generate',

    async buildStart(options) {
      // isWatch = this.meta.watchMode

      if (tsgo) {
        tsgoDist = await runTsgo(cwd, tsconfig)
      } else if (!oxc) {
        // tsc
        if (parallel) {
          childProcess = fork(new URL(WORKER_URL, import.meta.url), {
            stdio: 'inherit',
          })
          rpc = (await import('birpc')).createBirpc<TscFunctions>(
            {},
            {
              post: (data) => childProcess!.send(data),
              on: (fn) => childProcess!.on('message', fn),
            },
          )
        } else {
          tscModule = await import('./tsc/index.ts')
          if (newContext) {
            tscContext = createContext()
          }
        }
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

          if (!chunk.name.endsWith('.d')) return original

          // already a dts file
          if (RE_DTS.test(original)) {
            return original.replace('[name]', chunk.name.slice(0, -2))
          }
          return original.replace(RE_JS, '.$1ts')
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
          include: [RE_JS, RE_TS, RE_VUE],
          exclude: [RE_DTS, RE_NODE_MODULES],
        },
      },
      handler(code, id) {
        const shouldEmit = !RE_JS.test(id) || emitJs

        if (shouldEmit) {
          const mod = this.getModuleInfo(id)
          const isEntry = !!mod?.isEntry
          const dtsId = filename_to_dts(id)
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

        const { code, id } = dtsMap.get(dtsId)!
        let dtsCode: string | undefined
        let map: SourceMapInput | undefined
        let watched: string[] | undefined
        debug('generate dts %s from %s', dtsId, id)

        // Ensure the virtual dts module is invalidated whenever the source changes
        this.addWatchFile(id)

        if (tsgo) {
          if (RE_VUE.test(id))
            throw new Error('tsgo does not support Vue files.')
          const dtsPath = path.resolve(
            tsgoDist!,
            path.relative(path.resolve(cwd), filename_to_dts(id)),
          )
          if (existsSync(dtsPath)) {
            dtsCode = await readFile(dtsPath, 'utf8')
          } else {
            debug('[tsgo]', dtsPath, 'is missing')
            throw new Error(
              `tsgo did not generate dts file for ${id}, please check your tsconfig.`,
            )
          }
        } else if (oxc && !RE_VUE.test(id)) {
          const result = oxcIsolatedDeclaration(id, code, oxc)
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
          const entries = eager
            ? undefined
            : Array.from(dtsMap.values())
                .filter((v) => v.isEntry)
                .map((v) => v.id)
          const options: Omit<TscOptions, 'programs'> = {
            tsconfig,
            tsconfigRaw,
            build,
            incremental,
            cwd,
            entries,
            id,
            vue,
            context: tscContext,
          }
          let result: TscResult
          if (parallel) {
            result = await rpc!.tscEmit(options)
          } else {
            result = tscModule.tscEmit(options)
          }
          if (result.error) {
            return this.error(result.error)
          }
          dtsCode = result.code
          map = result.map
          watched = result.watchedFiles
        }

        const loaded = {
          code: dtsCode || '',
          moduleSideEffects: false,
          map,
        } as const

        // Ensure changes to any source in the active Program bubble up
        // to this virtual module in watch mode.
        if (watched && this.addWatchFile) {
          for (const f of watched) this.addWatchFile(f)
        }

        return loaded
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

    async buildEnd() {
      childProcess?.kill()
      if (!debug.enabled && tsgoDist) {
        await rm(tsgoDist, { recursive: true, force: true }).catch(() => {})
      }
      tsgoDist = undefined
      if (newContext) {
        tscContext = undefined
      }
    },

    watchChange(id) {
      if (tscModule) {
        const ctx = tscContext || globalContext
        // Targeted invalidation to keep incremental reuse effective
        invalidateContextFile(ctx, id)
      } else if (rpc) {
        rpc.invalidate(id)
      }
    },
  }
}

async function runTsgo(root: string, tsconfig?: string) {
  const tsgoPkg = import.meta.resolve('@typescript/native-preview/package.json')
  const { default: getExePath } = await import(
    new URL('./lib/getExePath.js', tsgoPkg).href
  )
  const tsgo = getExePath()
  const tsgoDist = await mkdtemp(path.join(tmpdir(), 'rolldown-plugin-dts-'))
  debug('[tsgo] tsgoDist', tsgoDist)

  await spawnAsync(
    tsgo,
    [
      '--noEmit',
      'false',
      '--declaration',
      '--emitDeclarationOnly',
      ...(tsconfig ? ['-p', tsconfig] : []),
      '--outDir',
      tsgoDist,
      '--rootDir',
      root,
      '--noCheck',
    ],
    { stdio: 'inherit' },
  )

  return tsgoDist
}
