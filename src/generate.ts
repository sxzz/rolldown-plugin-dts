import { fork, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parse } from '@babel/parser'
import Debug from 'debug'
import { isolatedDeclaration as oxcIsolatedDeclaration } from 'rolldown/experimental'
import {
  filename_to_dts,
  RE_DTS,
  RE_DTS_MAP,
  RE_JS,
  RE_JSON,
  RE_NODE_MODULES,
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
import type { OptionsResolved } from './options.ts'
import type { TscOptions, TscResult } from './tsc/index.ts'
import type { TscFunctions } from './tsc/worker.ts'
import type { TSPropertySignature } from '@babel/types'
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
  tsMacro,
  parallel,
  eager,
  tsgo,
  newContext,
  emitJs,
  sourcemap,
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
  | 'tsMacro'
  | 'parallel'
  | 'eager'
  | 'tsgo'
  | 'newContext'
  | 'emitJs'
  | 'sourcemap'
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
        if (!dtsMap.has(dtsId)) return

        const { code, id } = dtsMap.get(dtsId)!
        let dtsCode: string | undefined
        let map: SourceMapInput | undefined
        debug('generate dts %s from %s', dtsId, id)

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
            sourcemap,
            vue,
            tsMacro,
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

          if (dtsCode && RE_JSON.test(id)) {
            // if contains invalid json keys
            if (dtsCode.includes('declare const _exports')) {
              if (dtsCode.includes('declare const _exports: {')) {
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
        invalidateContextFile(tscContext || globalContext, id)
      }
    },
  }
}

async function runTsgo(root: string, tsconfig?: string) {
  const tsgoPkg = import.meta.resolve('@typescript/native-preview/package.json')
  const { default: getExePath } = await import(
    new URL('lib/getExePath.js', tsgoPkg).href
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

function collectJsonExportMap(code: string): Map<string, string> {
  const exportMap = new Map<string, string>()
  const { program } = parse(code, {
    sourceType: 'module',
    plugins: [['typescript', { dts: true }]],
    errorRecovery: true,
  })

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
  const { program } = parse(code, {
    sourceType: 'module',
    plugins: [['typescript', { dts: true }]],
  })
  const members = (program.body as any)[0].declarations[0].id.typeAnnotation
    .typeAnnotation.members as TSPropertySignature[]

  for (const member of members) {
    if (member.key.type === 'Identifier') {
      exports.push(member.key.name)
    } else if (member.key.type === 'StringLiteral') {
      exports.push(member.key.value)
    }
  }

  return exports
}
