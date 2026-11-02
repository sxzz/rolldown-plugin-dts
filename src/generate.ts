import { existsSync, realpathSync } from 'node:fs'
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
import type { InputOptions, Plugin, PluginContext } from 'rolldown'

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
    | 'emitDtsOnly'
    | 'languageContext'
    | 'tsc'
    | 'tsgo'
    | 'tsrs'
    | 'emitJs'
    | 'sourcemap'
  >,
): Plugin {
  const { entry, cwd, emitDtsOnly, languageContext, tsc, emitJs } = options
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
   * A map of dts id to source id, for the dts entries added to `input`
   *
   * Rolldown gives emitted entries a lower priority than input entries: a
   * common chunk can take their file name, and a facade is kept when they are
   * imported by another entry.
   */
  const dtsInputMap = new Map<string, string>()

  function addDtsInput(
    id: string,
    { cwd: inputCwd = cwd, resolve }: InputOptions,
  ): string | undefined {
    if (
      id[0] === '\0' ||
      RE_DTS.test(id) ||
      RE_NODE_MODULES.test(id) ||
      (!RE_TS.test(id) &&
        !RE_JSON.test(id) &&
        (!emitJs || !RE_JS.test(id)) &&
        !languageContext.isCustomLanguageFile(id))
    ) {
      return
    }

    // `options` has no `this.resolve`, so other inputs stay emitted entries.
    let sourceId = path.resolve(inputCwd, id)
    if (!existsSync(sourceId)) return
    if (resolve?.symlinks !== false) sourceId = realpathSync(sourceId)
    if (entryMatcher && !entryMatcher(path.relative(cwd, sourceId))) return

    const dtsId = filename_to_dts(sourceId, languageContext)
    dtsInputMap.set(dtsId, sourceId)
    return dtsId
  }

  let loadSource: PluginContext['load']
  const declarationGenerator = createGenerator(
    options,
    () =>
      tsc.eager
        ? undefined
        : Array.from(dtsMap.values())
            .filter((module) => module.isEntry)
            .map((module) => module.id),
    async (id) => {
      await loadSource({ id, resolveDependencies: false })
      // Cached modules may not run their transform hooks again in watch mode.
      const module = dtsMap.get(filename_to_dts(id, languageContext))
      if (module) declarationGenerator.addFile?.(module.code, module.id)
    },
  )

  return {
    name: 'rolldown-plugin-dts:generate',

    options(options) {
      const { input } = options
      if (!input) return

      if (typeof input === 'string' || Array.isArray(input)) {
        const inputs = [input].flat()
        const dtsInputs = inputs
          .map((id) => addDtsInput(id, options))
          .filter((id) => id !== undefined)
        return { ...options, input: [...inputs, ...dtsInputs] }
      }

      const dtsInputs: Record<string, string> = {}
      for (const [name, id] of Object.entries(input)) {
        const dtsId = addDtsInput(id, options)
        if (dtsId) dtsInputs[`${name}.d`] = dtsId
      }
      return { ...options, input: { ...input, ...dtsInputs } }
    },

    async buildStart(options) {
      loadSource = this.load.bind(this)
      await declarationGenerator.init?.()

      if (!Array.isArray(options.input)) {
        for (const [name, id] of Object.entries(options.input)) {
          if (dtsInputMap.has(id)) continue
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
      if (!dtsMap.has(id) && !dtsInputMap.has(id)) return

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

          if (isEntry && !dtsInputMap.has(dtsId)) {
            const name = inputAliasMap.get(id)
            this.emitFile({
              type: 'chunk',
              id: dtsId,
              name: name ? `${name}.d` : undefined,
            })
          }
        }

        // eslint-disable-next-line unicorn/prefer-early-return
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
        // An input can load before its source is transformed. Always wait for
        // the transform, `dtsMap` may hold the code of a previous build.
        const sourceId = dtsInputMap.get(dtsId)
        if (sourceId) {
          await this.load({ id: sourceId, resolveDependencies: false })
        }

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
