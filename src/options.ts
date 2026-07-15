import path from 'node:path'
import process from 'node:process'
import {
  getTsconfig,
  readTsconfig,
  type TsconfigJson,
  type TsconfigJsonResolved,
} from 'get-tsconfig'
import { createDebug } from 'obug'
import { requireTS } from './tsc/load-tsc.ts'
import { getVueVolarPlugin } from './tsc/vue.ts'
import { isTS70Installed } from './tsgo.ts'
import { VolarContext, type VolarPlugin } from './volar.ts'
import type { IsolatedDeclarationsOptions } from 'rolldown/experimental'

const debug = createDebug('rolldown-plugin-dts:options')

export interface Logger {
  info: (...args: any[]) => void
  warn: (...args: any[]) => void
  error: (...args: any[]) => void
}

//#region General Options
export interface GeneralOptions {
  /**
   * The generator used to produce `.d.ts` files.
   *
   * - `'tsc'`: The TypeScript 5.x/6.x compiler. Supports all TypeScript features.
   * - `'oxc'`: {@link https://oxc.rs Oxc}'s isolated declaration generator. Much
   *   faster than `tsc`, but only supports code that satisfies
   *   [`isolatedDeclarations`](https://www.typescriptlang.org/tsconfig/#isolatedDeclarations).
   * - `'tsgo'`: **[Experimental]** The TypeScript Go compiler
   *   ({@link https://github.com/microsoft/typescript-go tsgo}). May not support
   *   all TypeScript features yet.
   *
   * When unset, the generator is inferred:
   * - `'oxc'` if {@link Options.oxc oxc} options are provided or
   *   `isolatedDeclarations` is enabled in `compilerOptions`.
   * - `'tsgo'` if TypeScript 7.0 (or `@typescript/native-preview`) is installed,
   *   or {@link Options.tsgo tsgo} options are provided.
   * - `'tsc'` otherwise, and always when {@link TscOptions.vue vue} is enabled.
   *
   * @default 'tsc'
   */
  generator?: 'tsc' | 'oxc' | 'tsgo'

  /**
   * Glob pattern(s) to filter which entry files get `.d.ts` generation.
   *
   * When specified, only entry files matching these patterns will emit `.d.ts` chunks.
   * When not specified, all entries get `.d.ts` generation.
   *
   * Supports negation patterns (e.g., `['**', '!src/icons/**']`) for exclusion.
   * Patterns are matched against file paths relative to `cwd`.
   *
   * @example
   * entry: 'src/index.ts'
   * entry: ['src/*.ts', '!src/internal/**']
   */
  entry?: string | string[]

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
  tsconfigRaw?: Omit<TsconfigJson, 'compilerOptions'>

  /**
   * Override the `compilerOptions` specified in `tsconfig.json`.
   *
   * @see https://www.typescriptlang.org/tsconfig/#compilerOptions
   */
  compilerOptions?: TsconfigJson.CompilerOptions

  /**
   * If `true`, the plugin will generate declaration maps (`.d.ts.map`) for `.d.ts` files.
   */
  sourcemap?: boolean

  /**
   * Specifies a resolver to resolve type definitions, especially for `node_modules`.
   *
   * - `'oxc'`: Uses Oxc's module resolution, which is faster and more efficient.
   * - `'tsc'`: Uses TypeScript's native module resolution, which may be more compatible with complex setups, but slower.
   *
   * @default 'oxc'
   */
  resolver?: 'oxc' | 'tsc'

  /**
   * Determines how the default export is emitted.
   *
   * If set to `true`, and you are only exporting a single item using `export default ...`,
   * the output will use `export = ...` instead of the standard ES module syntax.
   * This is useful for compatibility with CommonJS.
   * This only controls the output format and does not enable support for
   * CommonJS-style `.d.ts` input.
   */
  cjsDefault?: boolean

  /**
   * Indicates whether the generated `.d.ts` files have side effects.
   * - If set to `true`, Rolldown will treat the `.d.ts` files as having side effects during tree-shaking.
   * - If set to `false`, Rolldown may consider the `.d.ts` files as side-effect-free, potentially removing them if they are not imported.
   *
   * @default false
   */
  sideEffects?: boolean

  logger?: Logger
}

//#region tsc Options
export interface TscOptions {
  /**
   * Build mode for the TypeScript compiler:
   *
   * - If `true`, the plugin will use [`tsc -b`](https://www.typescriptlang.org/docs/handbook/project-references.html#build-mode-for-typescript) to build the project and all referenced projects before emitting `.d.ts` files.
   * - If `false`, the plugin will use [`tsc`](https://www.typescriptlang.org/docs/handbook/compiler-options.html) to emit `.d.ts` files without building referenced projects.
   *
   * @default false
   */
  build?: boolean

  /**
   * If your tsconfig.json has
   * [`references`](https://www.typescriptlang.org/tsconfig/#references) option,
   * `rolldown-plugin-dts` will use [`tsc
   * -b`](https://www.typescriptlang.org/docs/handbook/project-references.html#build-mode-for-typescript)
   * to build the project and all referenced projects before emitting `.d.ts`
   * files.
   *
   * In such case, if this option is `true`, `rolldown-plugin-dts` will write
   * down all built files into your disk, including
   * [`.tsbuildinfo`](https://www.typescriptlang.org/tsconfig/#tsBuildInfoFile)
   * and other built files. This is equivalent to running `tsc -b` in your
   * project.
   *
   * Otherwise, if this option is `false`, `rolldown-plugin-dts` will write
   * built files only into memory and leave a small footprint in your disk.
   *
   * Enabling this option will decrease the build time by caching previous build
   * results. This is helpful when you have a large project with multiple
   * referenced projects.
   *
   * By default, `incremental` is `true` if your tsconfig has
   * [`incremental`](https://www.typescriptlang.org/tsconfig/#incremental) or
   * [`tsBuildInfoFile`](https://www.typescriptlang.org/tsconfig/#tsBuildInfoFile)
   * enabled.
   *
   * This option is only used when {@link Options.oxc} is
   * `false`.
   */
  incremental?: boolean

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

  /**
   * If `true`, the plugin will create a new isolated context for each build,
   * ensuring that previously generated `.d.ts` code and caches are not reused.
   *
   * By default, the plugin may reuse internal caches or incremental build artifacts
   * to speed up repeated builds. Enabling this option forces a clean context,
   * guaranteeing that all type definitions are generated from scratch.
   *
   * @default false
   */
  newContext?: boolean

  /**
   * If `true`, the plugin will emit `.d.ts` files for `.js` files as well.
   * This is useful when you want to generate type definitions for JavaScript files with JSDoc comments.
   *
   * Enabled by default when `allowJs` in compilerOptions is `true`.
   * This option is only used when {@link Options.oxc} is
   * `false`.
   */
  emitJs?: boolean
}

export interface Options extends GeneralOptions, TscOptions {
  //#region Oxc

  /**
   * If `true`, the plugin will generate `.d.ts` files using Oxc,
   * which is significantly faster than the TypeScript compiler.
   *
   * This option is automatically enabled when `isolatedDeclarations` in `compilerOptions` is set to `true`.
   */
  oxc?: boolean | Omit<IsolatedDeclarationsOptions, 'sourcemap'>

  //#region TypeScript Go

  /**
   * **[Experimental]** Enables DTS generation using `tsgo`.
   *
   * This is automatically enabled when the TypeScript Go compiler (v7+) is
   * installed as the `typescript` package. Otherwise, make sure
   * `@typescript/native-preview` is installed as a dependency, or provide a
   * custom path to the `tsgo` binary using the `path` option.
   *
   * **Note:** TypeScript 7.0 does not yet have a stable API and is experimental.
   * This option is not yet recommended for production environments, and some
   * options (such as `tsconfigRaw` and `isolatedDeclarations`) will be
   * unavailable when it is enabled.
   *
   *
   * ```ts
   * // Use tsgo from `@typescript/native-preview` dependency
   * tsgo: true
   *
   * // Use custom tsgo path (e.g., managed by Nix)
   * tsgo: { path: '/path/to/tsgo' }
   * ```
   */
  tsgo?: boolean | TsgoOptions

  /**
   * @experimental Maybe changed in future versions.
   */
  volarPlugin?: VolarPlugin
}

export interface TsgoOptions {
  /**
   * Custom path to the `tsgo` binary.
   */
  path?: string
}

type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U

export type OptionsResolved = Overwrite<
  Required<Omit<Options, 'compilerOptions' | 'vue' | 'volarPlugin'>>,
  {
    entry?: string[]
    tsconfig?: string
    oxc: IsolatedDeclarationsOptions
    tsconfigRaw: TsconfigJson
    tsgo: TsgoOptions
    volarContext?: VolarContext
  }
>

let warnedTsgo = false

export function resolveOptions({
  generator,
  entry,
  cwd = process.cwd(),
  dtsInput = false,
  emitDtsOnly = false,
  tsconfig,
  tsconfigRaw: overriddenTsconfigRaw = {},
  compilerOptions = {},
  sourcemap,
  resolver = 'oxc',
  cjsDefault = false,
  sideEffects = false,
  logger = console,
  volarPlugin,

  // tsc
  build = false,
  incremental = false,
  vue = false,
  parallel = false,
  eager = false,
  newContext = false,
  emitJs,

  oxc,
  tsgo,
}: Options): OptionsResolved {
  let resolvedTsconfig: TsconfigJsonResolved | undefined
  if (tsconfig === true || tsconfig == null) {
    const { config, path } = getTsconfig(cwd) || {}
    tsconfig = path
    resolvedTsconfig = config
  } else if (typeof tsconfig === 'string') {
    tsconfig = path.resolve(cwd || process.cwd(), tsconfig)
    resolvedTsconfig = readTsconfig(tsconfig).config
  } else {
    tsconfig = undefined
  }

  compilerOptions = {
    ...resolvedTsconfig?.compilerOptions,
    ...compilerOptions,
  }

  incremental ||=
    compilerOptions.incremental || !!compilerOptions.tsBuildInfoFile
  sourcemap ??= !!compilerOptions.declarationMap
  compilerOptions.declarationMap = sourcemap

  const tsconfigRaw = {
    ...resolvedTsconfig,
    ...overriddenTsconfigRaw,
    compilerOptions,
  }

  if (vue) {
    if (volarPlugin) {
      throw new Error(
        'The `volarPlugin` option is already set. The `vue` option is not compatible with `volarPlugin`.',
      )
    }
    volarPlugin = getVueVolarPlugin()
  }

  // Volar relate
  if (volarPlugin) {
    if (isTS70Installed()) {
      throw new Error(
        'TypeScript 7.0 does not yet have a stable API and is experimental. The `vue` and `volarPlugins` options are not yet supported with TypeScript 7.0.',
      )
    }
    if (generator && generator !== 'tsc') {
      logger.warn(
        'The `vue` and `volarPlugins` options are enabled, which requires the `tsc` generator. The `generator` option is ignored.',
      )
    }
    generator = 'tsc'
  }

  const volarContext = volarPlugin && new VolarContext(volarPlugin)

  if (!generator) {
    if (tsgo) {
      generator = 'tsgo'
    } else if (oxc || compilerOptions?.isolatedDeclarations) {
      generator = 'oxc'
    } else if (isTS70Installed()) {
      generator = 'tsgo'
    } else {
      generator = 'tsc'
    }
  }

  if (generator === 'tsc') {
    requireTS(
      'Or enable `isolatedDeclarations` in your `tsconfig.json` to use Oxc instead.',
    )
  } else if (generator === 'tsgo') {
    if (!tsconfig) {
      throw new Error(
        'tsgo generator requires a tsconfig file to be specified.',
      )
    }
    if (!warnedTsgo) {
      warnedTsgo = true
      logger.warn(
        'TypeScript 7.0 does not yet have a stable API and is experimental. Some options will be unavailable.',
      )
    }
  }

  if (oxc === true || !oxc) oxc = {}
  if (oxc) {
    oxc.stripInternal ??= !!compilerOptions?.stripInternal
    // @ts-expect-error omitted in user options
    oxc.sourcemap = !!compilerOptions.declarationMap
  }
  if (tsgo === true || !tsgo) tsgo = {}

  emitJs ??= !!(compilerOptions.checkJs || compilerOptions.allowJs)

  const resolvedEntry = entry
    ? Array.isArray(entry)
      ? entry
      : [entry]
    : undefined

  const resolved = {
    generator,
    entry: resolvedEntry,
    cwd,
    dtsInput,
    emitDtsOnly,
    tsconfig,
    tsconfigRaw,
    sourcemap,
    resolver,
    cjsDefault,
    sideEffects,

    // tsc
    build,
    incremental,
    parallel,
    eager,
    newContext,
    emitJs,
    volarContext,

    oxc,
    tsgo,
    logger,
  }
  debug('Resolved Options: %O', resolved)

  return resolved
}
