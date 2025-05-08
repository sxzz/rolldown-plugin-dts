import path from 'node:path'
import process from 'node:process'
import Debug from 'debug'
import { getTsconfig, parseTsconfig, type TsConfigJson } from 'get-tsconfig'
import { createDtsInputPlugin } from './dts-input.ts'
import { createFakeJsPlugin } from './fake-js.ts'
import { createGeneratePlugin } from './generate.ts'
import { createDtsResolvePlugin } from './resolve.ts'
import type { Plugin } from 'rolldown'
import type { IsolatedDeclarationsOptions } from 'rolldown/experimental'

const debug = Debug('rolldown-plugin-dts:options')

export interface Options {
  /**
   * The directory where the the plugin will look for the `tsconfig.json` file.
   */
  cwd?: string

  /**
   * When entries are `.d.ts` files (instead of `.ts` files), this option should be set to `true`.
   *
   * If enabled, the plugin will skip generating a `.d.ts` file for the entry point.
   */
  dtsInput?: boolean

  /**
   * When `true`, the plugin will only emit `.d.ts` files and remove all other chunks.
   *
   * This feature is particularly beneficial when you need to generate `d.ts` files for the CommonJS format as part of a separate build process.
   */
  emitDtsOnly?: boolean

  /**
   * The path to the `tsconfig.json` file.
   *
   * When set to `false`, the plugin will ignore any `tsconfig.json` file.
   * However, `compilerOptions` can still be specified directly in the options.
   *
   * @default `tsconfig.json`
   */
  tsconfig?: string | boolean

  /**
   * The `compilerOptions` for the TypeScript compiler.
   *
   * @see https://www.typescriptlang.org/docs/handbook/compiler-options.html
   */
  compilerOptions?: TsConfigJson.CompilerOptions

  /**
   * When `true`, the plugin will generate `.d.ts` files using Oxc,
   * which is blazingly faster than `typescript` compiler.
   *
   * This option is enabled when `isolatedDeclarations` in `compilerOptions` is set to `true`.
   */
  isolatedDeclarations?:
    | boolean
    | Omit<IsolatedDeclarationsOptions, 'sourcemap'>

  /**
   * When `true`, the plugin will generate declaration maps for `.d.ts` files.
   */
  sourcemap?: boolean

  /** Resolve external types used in dts files from `node_modules` */
  resolve?: boolean | (string | RegExp)[]
}

type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U

export type OptionsResolved = Overwrite<
  Required<Options>,
  {
    tsconfig: string | undefined
    isolatedDeclarations: IsolatedDeclarationsOptions | false
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
  isolatedDeclarations,
  sourcemap,
  dtsInput = false,
  emitDtsOnly = false,
  resolve = false,
}: Options): OptionsResolved {
  if (tsconfig === true || tsconfig == null) {
    const { config, path } = getTsconfig(cwd) || {}
    tsconfig = path
    compilerOptions = {
      ...config?.compilerOptions,
      ...compilerOptions,
    }
  } else if (typeof tsconfig === 'string') {
    tsconfig = path.resolve(cwd || process.cwd(), tsconfig)
    const config = parseTsconfig(tsconfig)
    compilerOptions = {
      ...config.compilerOptions,
      ...compilerOptions,
    }
  } else {
    tsconfig = undefined
  }

  sourcemap ??= !!compilerOptions.declarationMap
  compilerOptions.declarationMap = sourcemap

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
    compilerOptions,
    isolatedDeclarations,
    sourcemap,
    dtsInput,
    emitDtsOnly,
    resolve,
  }
}
