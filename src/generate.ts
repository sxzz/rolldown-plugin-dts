import { fork } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createDebug } from 'obug'
import { isolatedDeclarationSync } from 'rolldown/experimental'
import { is } from 'yuku-ast'
import { parse, type TSPropertySignature } from 'yuku-parser'
import {
  filename_to_dts,
  RE_DTS,
  RE_DTS_MAP,
  RE_JS,
  RE_JSON,
  RE_NODE_MODULES,
  RE_ROLLDOWN_RUNTIME,
  RE_TS,
  RE_VUE,
  replaceTemplateName,
  resolveTemplateFn,
} from './filename.ts'
import {
  createContext,
  globalContext,
  invalidateContextFile,
  type TscContext,
} from './tsc/context.ts'
import { runTsgo, type TsgoContext } from './tsgo.ts'
import type { OptionsResolved } from './options.ts'
import type { TscOptions, TscResult } from './tsc/index.ts'
import type { WorkerRequest, WorkerResponse } from './tsc/worker.ts'
import type { Plugin, SourceMapInput } from 'rolldown'

const debug = createDebug('rolldown-plugin-dts:generate')

const WORKER_URL = import.meta.WORKER_URL || './tsc/worker.ts'

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

export function createGeneratePlugin({
  generator,
  entry,
  tsconfig,
  tsconfigRaw,
  build,
  incremental,
  cwd,
  oxc,
  emitDtsOnly,
  vue,
  tsMacro,
  parallel,
  eager,
  tsgo,
  newContext,
  emitJs,
  sourcemap,
}: Pick<
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
  | 'vue'
  | 'tsMacro'
  | 'parallel'
  | 'eager'
  | 'tsgo'
  | 'newContext'
  | 'emitJs'
  | 'sourcemap'
>): Plugin {
  const entryIncludes = entry?.filter((p) => p[0] !== '!')
  const entryIgnores = entry?.filter((p) => p[0] === '!').map((p) => p.slice(1))
  const entryMatcher = entry
    ? (file: string) =>
        entryIncludes!.some((p) => path.matchesGlob(file, p)) &&
        !entryIgnores!.some((p) => path.matchesGlob(file, p))
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

  let tscWorker: TscWorker | undefined
  let tscModule: typeof import('./tsc/index.ts')
  let tscContext: TscContext | undefined
  let tsgoContext: TsgoContext | undefined
  const rootDir = tsconfig ? path.dirname(tsconfig) : cwd

  return {
    name: 'rolldown-plugin-dts:generate',

    async buildStart(options) {
      if (generator === 'tsgo') {
        tsgoContext = await runTsgo(rootDir, tsconfig, sourcemap, tsgo.path)
      } else if (generator === 'tsc') {
        if (parallel) {
          tscWorker = createTscWorker()
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
      if (dtsMap.has(id)) {
        debug('resolve dts id %s', id)
        return { id }
      }
    },

    transform: {
      order: 'pre',
      filter: {
        id: {
          include: [RE_JS, RE_TS, RE_VUE, RE_JSON],
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
          const dtsId = filename_to_dts(id)
          dtsMap.set(dtsId, { code, id, isEntry, jsFile })
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

        let dtsCode: string | undefined
        let map: SourceMapInput | undefined
        debug('generate dts %s from %s', dtsId, id)

        if (generator === 'tsgo') {
          if (RE_VUE.test(id))
            throw new Error('tsgo does not support Vue files.')
          const dtsPath = path.resolve(
            tsgoContext!.path,
            path.relative(path.resolve(rootDir), filename_to_dts(id)),
          )
          if (!existsSync(dtsPath)) {
            debug('[tsgo]', dtsPath, 'is missing')
            throw new Error(
              `tsgo did not generate dts file for ${id}, please check your tsconfig.`,
            )
          }

          dtsCode = await readFile(dtsPath, 'utf8')

          const mapPath = `${dtsPath}.map`
          if (existsSync(mapPath)) {
            const mapRaw = await readFile(mapPath, 'utf8')
            map = {
              ...JSON.parse(mapRaw),
              sources: [id],
            }
          }
        } else if (generator === 'oxc' && !RE_VUE.test(id)) {
          const result = isolatedDeclarationSync(id, code, oxc)
          if (result.errors.length) {
            const [error] = result.errors
            return this.error({
              message: error.message,
              frame: error.codeframe || undefined,
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
            sourcemap,
            vue,
            tsMacro,
            context: tscContext,
          }
          let result: TscResult
          if (parallel) {
            result = await tscWorker!.emit(options)
          } else {
            result = tscModule.tscEmit(options)
          }
          if (result.error) {
            return this.error(result.error)
          }
          dtsCode = result.code
          map = result.map

          if (dtsCode && RE_JSON.test(id)) {
            // if contains invalid json keys
            if (dtsCode.includes('declare const _exports')) {
              if (
                dtsCode.includes('declare const _exports: {') &&
                !dtsCode.includes('\n}[];')
              ) {
                // patch: add named export
                const exports = collectJsonExports(dtsCode)
                let i = 0
                dtsCode += exports
                  .map((e) => {
                    const valid = `_${e.replaceAll(/[^\w$]/g, '_')}${i++}`
                    const jsonKey = JSON.stringify(e)
                    return `declare let ${valid}: typeof _exports[${jsonKey}]\nexport { ${valid} as ${jsonKey} }`
                  })
                  .join('\n')
              }
            } else {
              // patch: add default export
              const exportMap = collectJsonExportMap(dtsCode)
              dtsCode += `
declare namespace __json_default_export {
  export { ${Array.from(exportMap.entries())
    .map(([exported, local]) =>
      exported === local ? exported : `${local} as ${exported}`,
    )
    .join(', ')} }
}
export { __json_default_export as default }`
            }
          }
        }

        return {
          code: dtsCode || '',
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

    async buildEnd() {
      tscWorker?.kill()
      tscWorker = undefined
      await tsgoContext?.dispose()
      tsgoContext = undefined
      if (newContext) {
        tscContext = undefined
      }
    },

    watchChange(id) {
      if (tscModule) {
        invalidateContextFile(tscContext || globalContext, id)
      }
    },
  }
}

interface TscWorker {
  emit: (options: TscOptions) => Promise<TscResult>
  kill: () => void
}

function createTscWorker(): TscWorker {
  const childProcess = fork(new URL(WORKER_URL, import.meta.url), {
    stdio: 'inherit',
    serialization: 'advanced',
  })

  const pending = new Map<
    number,
    {
      resolve: (result: TscResult) => void
      reject: (error: unknown) => void
    }
  >()
  let nextId = 0

  childProcess.on('message', (response: WorkerResponse) => {
    const handler = pending.get(response.id)
    if (!handler) return
    pending.delete(response.id)
    if (response.error) {
      handler.reject(response.error)
    } else {
      handler.resolve(response.result!)
    }
  })

  childProcess.on('exit', (code) => {
    for (const handler of pending.values()) {
      handler.reject(new Error(`tsc worker exited with code ${code}`))
    }
    pending.clear()
  })

  return {
    emit: (options) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        childProcess.send({ id, options } satisfies WorkerRequest)
      }),
    kill: () => childProcess.kill(),
  }
}

function collectJsonExportMap(code: string): Map<string, string> {
  const exportMap = new Map<string, string>()
  const { program } = parse(code, { sourceType: 'module', lang: 'dts' })

  for (const decl of program.body) {
    if (decl.type === 'ExportNamedDeclaration') {
      // export declare let Hello: string;
      if (decl.declaration) {
        if (decl.declaration.type === 'VariableDeclaration') {
          for (const vdecl of decl.declaration.declarations) {
            if (vdecl.id.type === 'Identifier') {
              exportMap.set(vdecl.id.name, vdecl.id.name)
            }
          }
        } else if (
          decl.declaration.type === 'TSModuleDeclaration' &&
          decl.declaration.id.type === 'Identifier'
        ) {
          exportMap.set(decl.declaration.id.name, decl.declaration.id.name)
        }
      } else if (decl.specifiers.length) {
        for (const spec of decl.specifiers) {
          if (
            spec.type === 'ExportSpecifier' &&
            spec.exported.type === 'Identifier'
          ) {
            // declare let _class: string
            // export { _class as class }
            exportMap.set(
              spec.exported.name,
              spec.local.type === 'Identifier'
                ? spec.local.name
                : spec.exported.name,
            )
          }
        }
      }
    }
  }

  return exportMap
}

/** `declare const _exports` mode */
function collectJsonExports(code: string) {
  const exports: string[] = []
  const { program } = parse(code, { sourceType: 'module', lang: 'dts' })
  const members = (program.body as any)[0].declarations[0].id.typeAnnotation
    .typeAnnotation.members as TSPropertySignature[]

  for (const member of members) {
    if (member.key.type === 'Identifier') {
      exports.push(member.key.name)
    } else if (is.StringLiteral(member.key)) {
      exports.push(member.key.value)
    }
  }

  return exports
}
