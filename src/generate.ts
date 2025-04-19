import { createResolver, type Resolver } from 'dts-resolver'
import { getTsconfig, parseTsconfig } from 'get-tsconfig'
import { isolatedDeclaration as oxcIsolatedDeclaration } from 'oxc-transform'
import {
  filename_dts_to,
  filename_js_to_dts,
  filename_ts_to_dts,
  isRelative,
  RE_DTS,
  RE_JS,
  RE_NODE_MODULES,
  RE_TS,
} from './utils/filename'
import { createOrGetTsModule, initTs, tscEmit } from './utils/tsc'
import type { Options } from '.'
import type { Plugin } from 'rolldown'
import type * as Ts from 'typescript'

const meta = { dtsFile: true } as const

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
  compilerOptions,
  isolatedDeclarations,
  resolve = false,
  emitDtsOnly = false,
}: Pick<
  Options,
  | 'isolatedDeclarations'
  | 'resolve'
  | 'emitDtsOnly'
  | 'tsconfig'
  | 'compilerOptions'
>): Plugin {
  const dtsMap: DtsMap = new Map<string, TsModule>()

  function resolveOptions(cwd?: string) {
    if (tsconfig === true || tsconfig == null) {
      const { config, path } = getTsconfig(cwd) || {}
      tsconfig = path
      compilerOptions = {
        ...config?.compilerOptions,
        ...compilerOptions,
      }
    } else if (typeof tsconfig === 'string') {
      const config = parseTsconfig(tsconfig)
      compilerOptions = {
        ...config.compilerOptions,
        ...compilerOptions,
      }
    }

    if (isolatedDeclarations == null) {
      isolatedDeclarations = !!compilerOptions?.isolatedDeclarations
    }
    if (isolatedDeclarations === true) {
      isolatedDeclarations = {}
    }
    if (isolatedDeclarations && isolatedDeclarations.stripInternal == null) {
      isolatedDeclarations.stripInternal = !!compilerOptions?.stripInternal
    }
  }

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
  let resolver: Resolver
  let programs: Ts.Program[] = []

  return {
    name: 'rolldown-plugin-dts:generate',

    async buildStart(options) {
      resolveOptions(options.cwd)
      resolver = createResolver({
        tsconfig: tsconfig ? (tsconfig as string) : undefined,
      })

      if (!isolatedDeclarations) {
        initTs()
      }

      if (!Array.isArray(options.input)) {
        for (const [name, id] of Object.entries(options.input)) {
          let resolved = await this.resolve(id, undefined, {
            skipSelf: true,
          })
          resolved ||= await this.resolve(`./${id}`, undefined, {
            skipSelf: true,
          })
          inputAliasMap.set(resolved?.id || id, name)
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
          if (chunk.name.endsWith('.d')) {
            return original.replace(RE_JS, '.$1ts')
          }
          return original
        },
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

    resolveId: {
      order: 'pre',
      async handler(id, importer, options) {
        if (dtsMap.has(id)) {
          // must be dts entry
          return { id, meta }
        }

        if (!importer || !this.getModuleInfo(importer)?.meta.dtsFile) {
          return
        }
        // in dts file

        if (RE_DTS.test(id)) {
          const resolution = await this.resolve(id, importer, options)
          if (!resolution) return
          return { ...resolution, meta }
        }

        // link to the original module
        let resolution = await this.resolve(id, filename_dts_to(importer, 'ts'))
        if (!resolution) return

        // resolve dependency
        if (RE_NODE_MODULES.test(resolution.id) || !isRelative(resolution.id)) {
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
        } else if (resolution.external) {
          return resolution
        }

        let dtsId: string
        if (RE_JS.test(resolution.id)) {
          // resolve dts for js
          resolution = await this.resolve(
            filename_js_to_dts(resolution.id),
            importer,
            { skipSelf: false },
          )
          if (!resolution) return
          dtsId = resolution.id
        } else {
          dtsId = filename_ts_to_dts(resolution.id)
          if (dtsMap.has(dtsId)) {
            return { id: dtsId, meta }
          }
        }

        await this.load(resolution)

        if (RE_DTS.test(resolution.id) || dtsMap.has(dtsId)) {
          return { id: dtsId, meta }
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

        if (isolatedDeclarations) {
          const result = oxcIsolatedDeclaration(
            id,
            code,
            isolatedDeclarations === true ? {} : isolatedDeclarations,
          )
          if (result.errors.length) {
            const [error] = result.errors
            return this.error({
              message: error.message,
              frame: error.codeframe,
            })
          }
          dtsCode = result.code
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
        }

        if (!dtsCode) {
          return this.error(new Error(`Failed to generate dts for ${id}`))
        }

        return {
          code: dtsCode,
          moduleSideEffects: false,
        }
      },
    },

    generateBundle: emitDtsOnly
      ? (options, bundle) => {
          for (const fileName of Object.keys(bundle)) {
            if (!RE_DTS.test(fileName)) {
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
