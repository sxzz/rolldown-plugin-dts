import path from 'node:path'
import process from 'node:process'
import Debug from 'debug'
import {
  getTsconfig,
  parseTsconfig,
  type TsConfigJson,
  type TsConfigJsonResolved,
} from 'get-tsconfig'
import { createDtsInputPlugin } from './dts-input.ts'
import { createFakeJsPlugin } from './fake-js.ts'
import { createGeneratePlugin } from './generate.ts'
import { createDtsResolvePlugin } from './resolve.ts'
import type { Plugin } from 'rolldown'
import type { IsolatedDeclarationsOptions } from 'rolldown/experimental'

export {
  RE_CSS,
  RE_DTS,
  RE_DTS_MAP,
  RE_JS,
  RE_NODE_MODULES,
  RE_TS,
  RE_VUE,
} from './filename.ts'

const debug = Debug('rolldown-plugin-dts:options')

export interface Options {
  /**
   * The directory in which the plugin will search for the `tsconfig.json` file.
   */
  cwd?: string

  /**
   * Set to `true` if your entry files are `.d.ts` files instead of `.ts` files.
   *
   * When enabled, the plugin will skip generating a `.d.ts` file for the entry point.
   */
  dtsInput?: boolean

  /**
   * If `true`, the plugin will emit only `.d.ts` files and remove all other output chunks.
   *
   * This is especially useful when generating `.d.ts` files for the CommonJS format as part of a separate build step.
   */
  emitDtsOnly?: boolean

  /**
   * The path to the `tsconfig.json` file.
   *
   * If set to `false`, the plugin will ignore any `tsconfig.json` file.
   * You can still specify `compilerOptions` directly in the options.
   *
   * @default 'tsconfig.json'
   */
  tsconfig?: string | boolean

  /**
   * Pass a raw `tsconfig.json` object directly to the plugin.
   *
   * @see https://www.typescriptlang.org/tsconfig
   */
  tsconfigRaw?: Omit<TsConfigJson, 'compilerOptions'>

  /**
   * Override the `compilerOptions` specified in `tsconfig.json`.
   *
   * @see https://www.typescriptlang.org/tsconfig/#compilerOptions
   */
  compilerOptions?: TsConfigJson.CompilerOptions

  /**
   * If `true`, the plugin will generate `.d.ts` files using Oxc,
   * which is significantly faster than the TypeScript compiler.
   *
   * This option is automatically enabled when `isolatedDeclarations` in `compilerOptions` is set to `true`.
   */
  isolatedDeclarations?:
    | boolean
    | Omit<IsolatedDeclarationsOptions, 'sourcemap'>

  /**
   * If `true`, the plugin will generate declaration maps (`.d.ts.map`) for `.d.ts` files.
   */
  sourcemap?: boolean

  /**
   * Resolve external types used in `.d.ts` files from `node_modules`.
   */
  resolve?: boolean | (string | RegExp)[]

  /**
   * If `true`, the plugin will generate `.d.ts` files using `vue-tsc`.
   */
  vue?: boolean

  /**
   * If `true`, the plugin will launch a separate process for `tsc` or `vue-tsc`.
   * This enables processing multiple projects in parallel.
   */
  parallel?: boolean

  /**
   * If `true`, the plugin will prepare all files listed in `tsconfig.json` for `tsc` or `vue-tsc`.
   *
   * This is especially useful when you have a single `tsconfig.json` for multiple projects in a monorepo.
   */
  eager?: boolean
}

type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U

export type OptionsResolved = Overwrite<
  Required<Omit<Options, 'compilerOptions'>>,
  {
    tsconfig: string | undefined
    isolatedDeclarations: IsolatedDeclarationsOptions | false
    tsconfigRaw: TsConfigJson
  }
>

export function dts(options: Options = {}): Plugin[] {
  debug('resolving dts options')
  const resolved = resolveOptions(options)
  debug('resolved dts options %o', resolved)

  const plugins: Plugin[] = []
  if (options.dtsInput) {
    plugins.push(createDtsInputPlugin())
  } else {
    plugins.push(createGeneratePlugin(resolved))
  }
  plugins.push(createDtsResolvePlugin(resolved), createFakeJsPlugin(resolved))
  return plugins
}

export { createFakeJsPlugin, createGeneratePlugin }

export function resolveOptions({
  cwd = process.cwd(),
  tsconfig,
  compilerOptions = {},
  tsconfigRaw: overriddenTsconfigRaw = {},
  isolatedDeclarations,
  sourcemap,
  dtsInput = false,
  emitDtsOnly = false,
  resolve = false,
  vue = false,
  parallel = false,
  eager = false,
}: Options): OptionsResolved {
  let resolvedTsconfig: TsConfigJsonResolved | undefined
  if (tsconfig === true || tsconfig == null) {
    const { config, path } = getTsconfig(cwd) || {}
    tsconfig = path
    resolvedTsconfig = config
  } else if (typeof tsconfig === 'string') {
    tsconfig = path.resolve(cwd || process.cwd(), tsconfig)
    resolvedTsconfig = parseTsconfig(tsconfig)
  } else {
    tsconfig = undefined
  }

  compilerOptions = {
    ...resolvedTsconfig?.compilerOptions,
    ...compilerOptions,
  }

  sourcemap ??= !!compilerOptions.declarationMap
  compilerOptions.declarationMap = sourcemap

  const tsconfigRaw = {
    ...resolvedTsconfig,
    ...overriddenTsconfigRaw,
    compilerOptions,
  }

  if (isolatedDeclarations == null) {
    isolatedDeclarations = !!compilerOptions?.isolatedDeclarations
  }
  if (isolatedDeclarations === true) {
    isolatedDeclarations = {}
  }
  if (isolatedDeclarations) {
    isolatedDeclarations.stripInternal ??= !!compilerOptions?.stripInternal
    // @ts-expect-error omitted in user options
    isolatedDeclarations.sourcemap = !!compilerOptions.declarationMap
  }

  return {
    cwd,
    tsconfig,
    tsconfigRaw,
    isolatedDeclarations,
    sourcemap,
    dtsInput,
    emitDtsOnly,
    resolve,
    vue,
    parallel,
    eager,
  }
}
