import { basename, extname } from 'node:path'
import { createResolver } from 'dts-resolver'
import { getTsconfig } from 'get-tsconfig'
import { isolatedDeclaration as oxcIsolatedDeclaration } from 'oxc-transform'
import {
  filename_dts_to,
  filename_ts_to_dts,
  isRelative,
  RE_DTS,
  RE_JS,
  RE_NODE_MODULES,
  RE_TS,
} from './utils/filename'
import {
  createOrGetTsModule,
  initTs,
  tscEmit,
  type TsProgram,
} from './utils/tsc'
import type { Options } from '.'
import type { Plugin } from 'rolldown'

const meta = { dtsFile: true } as const

export function createGeneratePlugin({
  compilerOptions,
  isolatedDeclaration,
  inputAlias,
  resolve = false,
  emitDtsOnly = false,
}: Pick<
  Options,
  | 'isolatedDeclaration'
  | 'inputAlias'
  | 'resolve'
  | 'emitDtsOnly'
  | 'compilerOptions'
>): Plugin {
  const dtsMap = new Map<string, { code: string; src: string }>()
  const inputAliasMap = new Map<string, string>(
    inputAlias && Object.entries(inputAlias),
  )
  const resolver = createResolver()
  let programs: TsProgram[] = []

  let inputOption: Record<string, string> | undefined
  return {
    name: 'rolldown-plugin-dts:generate',

    buildStart(options) {
      if (isolatedDeclaration == null) {
        const { config } = getTsconfig(options.cwd) || {}
        if (config?.compilerOptions?.isolatedDeclarations) {
          isolatedDeclaration = {
            stripInternal: !!config?.compilerOptions.stripInternal,
          }
        }
      }

      if (!isolatedDeclaration) {
        initTs()
      }
    },

    options({ input }) {
      if (isPlainObject(input)) {
        inputOption = { ...input }
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
        let dtsCode: string | undefined

        const mod = this.getModuleInfo(id)
        const isEntry = mod?.isEntry

        if (isolatedDeclaration) {
          const result = oxcIsolatedDeclaration(
            id,
            code,
            isolatedDeclaration === true ? {} : isolatedDeclaration,
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
            code,
            isEntry,
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

        const dtsId = filename_ts_to_dts(id)
        dtsMap.set(dtsId, {
          code: dtsCode,
          src: id,
        })

        if (isEntry) {
          let name: string | undefined = basename(dtsId, extname(dtsId))
          if (inputAliasMap.has(name)) {
            name = inputAliasMap.get(name)!
          } else if (inputAliasMap.has(dtsId)) {
            name = inputAliasMap.get(dtsId)!
          }
          this.emitFile({
            type: 'chunk',
            id: dtsId,
            name,
          })

          if (emitDtsOnly) {
            return '//' // placeholder
          }
        }
      },
    },

    async resolveId(id, importer, extraOptions) {
      // must be entry
      if (dtsMap.has(id)) {
        return { id, meta }
      }

      if (importer && this.getModuleInfo(importer)?.meta.dtsFile) {
        // in dts file

        // resolve dependency
        if (!isRelative(id)) {
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

        // link to the original module
        const resolution = await this.resolve(
          id,
          filename_dts_to(importer!, 'ts'),
        )
        if (!resolution || resolution.external) return

        const dtsId = filename_ts_to_dts(resolution.id)
        if (dtsMap.has(dtsId)) {
          return { id: dtsId, meta }
        }

        // pre-load original module if not already loaded
        await this.load(resolution)
        if (dtsMap.has(dtsId)) {
          return { id: dtsId, meta }
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
            code: dtsMap.get(id)!.code,
            moduleSideEffects: false,
          }
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

function isPlainObject(data: unknown): data is Record<PropertyKey, unknown> {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  const proto = Object.getPrototypeOf(data)
  return proto === null || proto === Object.prototype
}
