import { access } from 'node:fs/promises'
import path from 'node:path'
import { createDebug } from 'obug'
import {
  filename_to_dts,
  RE_DTS,
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
import type { Plugin, PluginContext, ResolvedId } from 'rolldown'

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
    | 'oxc'
    | 'dtsOnly'
    | 'languageContext'
    | 'tsc'
    | 'tsgo'
    | 'tsrs'
    | 'emitJs'
    | 'sourcemap'
  >,
): Plugin {
  const { entry, cwd, dtsOnly, languageContext, tsc, emitJs } = options
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

  /**
   * In `dtsOnly` mode, entries resolve to their declaration, so the source
   * modules are not Rolldown entries. Maps the declaration id to the source.
   */
  const dtsOnlyEntries = new Map<string, ResolvedId>()

  /**
   * Resolved Rolldown inputs in `dtsOnly` mode. Rolldown resolves entries
   * concurrently, so a declaration may be emitted before every entry is known.
   * Passing all of them upfront lets tsc build one program instead of several.
   */
  const inputIds = new Set<string>()

  function isSourceFile(id: string) {
    return (
      !RE_DTS.test(id) &&
      !RE_NODE_MODULES.test(id) &&
      (RE_TS.test(id) ||
        RE_JSON.test(id) ||
        (emitJs && RE_JS.test(id)) ||
        languageContext.isCustomLanguageFile(id))
    )
  }

  let loadSource: PluginContext['load']
  const declarationGenerator = createGenerator(
    options,
    () =>
      tsc.eager
        ? undefined
        : [
            ...new Set([
              ...inputIds,
              ...Array.from(dtsMap.values())
                .filter((module) => module.isEntry)
                .map((module) => module.id),
            ]),
          ],
    async (id) => {
      await loadSource({ id, resolveDependencies: false })
      // Cached modules may not run their transform hooks again in watch mode.
      const module = dtsMap.get(filename_to_dts(id, languageContext))
      if (module) declarationGenerator.addFile?.(module.code, module.id)
    },
  )

  return {
    name: 'rolldown-plugin-dts:generate',

    async buildStart(options) {
      loadSource = this.load.bind(this)
      await declarationGenerator.init?.()

      dtsOnlyEntries.clear()
      inputIds.clear()
      if (Array.isArray(options.input) && !dtsOnly) return

      const inputs: [name: string | undefined, id: string][] = Array.isArray(
        options.input,
      )
        ? options.input.map((id) => [undefined, id])
        : Object.entries(options.input)
      for (const [name, id] of inputs) {
        debug('resolving input %s -> %s', name, id)
        let resolved = await this.resolve(id)
        if (!id.startsWith('./')) {
          resolved ||= await this.resolve(`./${id}`)
        }
        const resolvedId = resolved?.id || id
        debug('resolved input %s -> %s', id, resolvedId)
        if (name) inputAliasMap.set(resolvedId, name)
        if (dtsOnly && isSourceFile(resolvedId)) inputIds.add(resolvedId)
      }
    },

    // `dtsOnly` builds are named by the dts-only plugin.
    outputOptions: dtsOnly
      ? undefined
      : (options) => {
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
                  return replaceTemplateName(
                    nameTemplate,
                    chunk.name.slice(0, -2),
                  )
                }
                if (RE_JS.test(nameTemplate)) {
                  return nameTemplate.replace(RE_JS, '.$1ts')
                }
              }

              return nameTemplate
            },
          }
        },

    resolveId: {
      order: dtsOnly ? 'pre' : undefined,
      async handler(id, importer, extraOptions) {
        if (dtsMap.has(id)) {
          debug('resolve dts id %s', id)
          return { id }
        }

        if (!dtsOnly || importer || !extraOptions.isEntry) return

        // Start the entry from its declaration. The source module is loaded
        // when the declaration is, only to register its code, and stays out of
        // every chunk. Loading it here would hang: Rolldown loads no module
        // before all entries are resolved.
        const resolved = await this.resolve(id, importer, {
          ...extraOptions,
          skipSelf: true,
        })
        if (!resolved || resolved.external || !isSourceFile(resolved.id)) {
          return resolved
        }
        const dtsId = filename_to_dts(resolved.id, languageContext)
        dtsOnlyEntries.set(dtsId, resolved)
        debug('resolve dts-only entry %s -> %s', id, dtsId)
        return { id: dtsId }
      },
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
          const dtsId = filename_to_dts(id, languageContext)
          const isDtsOnlyEntry = dtsOnlyEntries.get(dtsId)?.id === id
          // `entry` only filters Rolldown entries; it never adds files.
          const isEntry =
            isDtsOnlyEntry ||
            (!!mod?.isEntry &&
              (!entryMatcher || entryMatcher(path.relative(cwd, id))))
          dtsMap.set(dtsId, { code, id, isEntry, jsFile })
          declarationGenerator.addFile?.(code, id)
          debug('register dts source: %s', id)

          // A `dtsOnly` entry resolves to its declaration already.
          if (isEntry && !isDtsOnlyEntry) {
            const name = inputAliasMap.get(id)
            this.emitFile({
              type: 'chunk',
              id: dtsId,
              name: name ? `${name}.d` : undefined,
            })
          }
        }

        // Source modules only provide code for their declarations.
        if (dtsOnly) {
          return { code: EMPTY_STUB, moduleType: 'js' }
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
        const source = dtsOnlyEntries.get(dtsId)
        if (source) await this.load(source)

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

    async buildEnd() {
      await declarationGenerator.dispose?.()
    },

    watchChange(id) {
      declarationGenerator.invalidate?.(id)
    },
  }
}
