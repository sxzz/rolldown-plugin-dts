import { access } from 'node:fs/promises'
import path from 'node:path'
import { createDebug } from 'obug'
import {
  filename_to_dts,
  RE_DTS,
  RE_DTS_MAP,
  RE_JS,
  RE_JSON,
  RE_NODE_MODULES,
  RE_ROLLDOWN_RUNTIME,
  RE_TS,
  replaceTemplateName,
  resolveTemplateFn,
} from './filename.ts'
import { createGenerator } from './generator/index.ts'
import type { OptionsResolved } from './options.ts'
import type { Plugin } from 'rolldown'

const debug = createDebug('rolldown-plugin-dts:generate')

export const EMPTY_STUB = `export {}`

export interface TsModule {
  /** `.ts` source code */
  code: string
  /** `.ts` file name */
  id: string
  isEntry: boolean
  jsFile: boolean
}
/** dts filename -> ts module */
export type DtsMap = Map<string, TsModule>

export function createGeneratePlugin(
  options: Pick<
    OptionsResolved,
    | 'generator'
    | 'entry'
    | 'cwd'
    | 'tsconfig'
    | 'tsconfigRaw'
    | 'build'
    | 'incremental'
    | 'oxc'
    | 'emitDtsOnly'
    | 'languageContext'
    | 'parallel'
    | 'eager'
    | 'tsgo'
    | 'newContext'
    | 'emitJs'
    | 'sourcemap'
  >,
): Plugin {
  const { entry, cwd, emitDtsOnly, languageContext, eager, emitJs } = options
  const entryIncludes = entry?.filter((p) => p[0] !== '!')
  const entryIgnores = entry?.filter((p) => p[0] === '!').map((p) => p.slice(1))
  const entryMatcher = entry
    ? (file: string) =>
        entryIncludes!.some((p) => path.matchesGlob(file, p)) &&
        entryIgnores!.every((p) => !path.matchesGlob(file, p))
    : undefined
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

  const declarationGenerator = createGenerator(options, () =>
    eager
      ? undefined
      : Array.from(dtsMap.values())
          .filter((module) => module.isEntry)
          .map((module) => module.id),
  )

  return {
    name: 'rolldown-plugin-dts:generate',

    async buildStart(options) {
      await declarationGenerator.init?.()

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
          const { entryFileNames } = options
          const nameTemplate = resolveTemplateFn(
            entryFileNames || '[name].js',
            chunk,
          )

          if (chunk.name.endsWith('.d')) {
            if (RE_DTS.test(nameTemplate)) {
              return replaceTemplateName(nameTemplate, chunk.name.slice(0, -2))
            }
            if (RE_JS.test(nameTemplate)) {
              return nameTemplate.replace(RE_JS, '.$1ts')
            }
          }

          return nameTemplate
        },
      }
    },

    resolveId(id) {
      if (!dtsMap.has(id)) return

      debug('resolve dts id %s', id)
      return { id }
    },

    transform: {
      order: 'pre',
      filter: {
        id: {
          include: [RE_JS, RE_TS, RE_JSON, ...languageContext.patterns],
          exclude: [RE_DTS, RE_NODE_MODULES, RE_ROLLDOWN_RUNTIME],
        },
      },
      handler(code, id) {
        const jsFile = RE_JS.test(id)

        if (!jsFile || emitJs) {
          const mod = this.getModuleInfo(id)
          const isEntry = entryMatcher
            ? entryMatcher(path.relative(cwd, id))
            : !!mod?.isEntry
          const dtsId = filename_to_dts(id, languageContext)
          dtsMap.set(dtsId, { code, id, isEntry, jsFile })
          declarationGenerator.addFile?.(code, id)
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
          if (RE_JSON.test(id)) return '{}'
          return EMPTY_STUB
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
        const module = dtsMap.get(dtsId)
        if (!module) return

        const { code, id, jsFile } = module
        if (
          jsFile &&
          (await access(dtsId)
            .then(() => true)
            .catch(() => false))
        ) {
          debug('dts file already exists for %s, skipping generation', id)
          return
        }

        debug('generate dts %s from %s', dtsId, id)

        const result = await declarationGenerator.emit(code, id)
        if (result.error) {
          return this.error(result.error)
        }

        return {
          code: result.code || '',
          map: result.map,
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

    async buildEnd() {
      await declarationGenerator.dispose?.()
    },

    watchChange(id) {
      declarationGenerator.invalidate?.(id)
    },
  }
}
