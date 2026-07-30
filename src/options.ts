import path from 'node:path'
import process from 'node:process'
import {
  getTsconfig,
  readTsconfig,
  type TsconfigJson,
  type TsconfigJsonResolved,
} from 'get-tsconfig'
import { createDebug } from 'obug'
import { LanguageContext, type CustomLanguage } from './custom-language.ts'
import { isTS70Installed, requireTSApi } from './require.ts'
import { createVueLanguage } from './tsc/vue.ts'
import { resolveTsgoPath } from './tsgo.ts'
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
   * The generator used to produce declaration files.
   *
   * - `'tsc'` supports the full TypeScript type system.
   * - `'oxc'` is faster but requires code compatible with
   *   [`isolatedDeclarations`](https://www.typescriptlang.org/tsconfig/#isolatedDeclarations).
   * - `'tsgo'` uses the experimental TypeScript Go compiler.
   *
   * When omitted, the plugin selects `'oxc'` for `isolatedDeclarations`,
   * `'tsgo'` for TypeScript 7, and `'tsc'` otherwise. Volar-based custom
   * languages require `'tsc'`.
   *
   * @default Inferred from the TypeScript configuration and installed compiler.
   */
  generator?: 'tsc' | 'oxc' | 'tsgo'

  /**
   * Glob pattern(s) that select source files for declaration generation.
   *
   * Patterns are relative to {@link cwd} and may be negated with `!`. Matching
   * files are emitted even when they are not Rolldown entry points.
   *
   * @example
   * ```ts
   * entry: ['src/*.ts', '!src/internal/**']
   * ```
   */
  entry?: string | string[]

  /**
   * Base directory for config discovery, glob matching, and relative paths.
   *
   * @default process.cwd()
   */
  cwd?: string

  /**
   * Treats entry files as existing declarations instead of source files.
   *
   * @default false
   */
  dtsInput?: boolean

  /**
   * Removes non-declaration chunks from the output.
   *
   * @default false
   */
  emitDtsOnly?: boolean

  /**
   * A `tsconfig.json` path, resolved relative to {@link cwd}.
   *
   * When omitted or `true`, the nearest config is discovered from {@link cwd}.
   * Set to `false` to disable config loading.
   */
  tsconfig?: string | boolean

  /** Raw `tsconfig.json` values merged over the loaded config. */
  tsconfigRaw?: Omit<TsconfigJson, 'compilerOptions'>

  /**
   * Compiler options merged over those loaded from `tsconfig.json`.
   */
  compilerOptions?: TsconfigJson.CompilerOptions

  /**
   * Emits declaration maps (`.d.ts.map`).
   *
   * @default The value of `compilerOptions.declarationMap`.
   */
  sourcemap?: boolean

  /**
   * Resolver used for declaration imports, including packages in `node_modules`.
   *
   * Use `'tsc'` when a project depends on TypeScript-specific resolution
   * behavior; otherwise `'oxc'` is faster.
   *
   * @default 'oxc'
   */
  resolver?: 'oxc' | 'tsc'

  /**
   * Converts a single default export to `export =` for CommonJS consumers.
   * This does not add support for CommonJS-style declaration input.
   *
   * @default false
   */
  cjsDefault?: boolean

  /**
   * Marks declaration modules as having side effects during tree-shaking.
   *
   * @default false
   */
  sideEffects?: boolean

  /**
   * Logger used for plugin messages.
   *
   * @default console
   */
  logger?: Logger
}

//#region tsc Options
export interface TscOptions {
  /**
   * Uses TypeScript build mode (`tsc -b`) and follows project references.
   *
   * @default false
   */
  build?: boolean

  /**
   * Persists build-mode outputs, including `.tsbuildinfo`, to disk for reuse.
   * When disabled, build outputs stay in memory.
   *
   * @default Enabled when the config sets `incremental` or `tsBuildInfoFile`.
   */
  incremental?: boolean

  /**
   * Registers the built-in Vue language integration using `vue-tsc`.
   *
   * This is a shortcut for a preconfigured {@link Options.customLanguages}
   * entry and requires the `tsc` generator.
   *
   * @default false
   */
  vue?: boolean

  /**
   * Runs `tsc` or `vue-tsc` in a separate process.
   *
   * @default false
   */
  parallel?: boolean

  /**
   * Loads every file listed by `tsconfig.json` into the TypeScript program.
   *
   * Useful when one config covers multiple packages or entry points.
   *
   * @default false
   */
  eager?: boolean

  /**
   * Uses an isolated TypeScript cache instead of the shared global context.
   *
   * @default false
   */
  newContext?: boolean

  /**
   * Generates declarations for JavaScript files with JSDoc types.
   *
   * @default Enabled when `allowJs` or `checkJs` is set.
   */
  emitJs?: boolean
}

/** Configuration accepted by {@link dts}. */
export interface Options extends GeneralOptions, TscOptions {
  //#region Oxc

  /**
   * Options for the `oxc` generator.
   *
   * The top-level {@link GeneralOptions.sourcemap sourcemap} option controls
   * declaration maps.
   */
  oxc?: Omit<IsolatedDeclarationsOptions, 'sourcemap'>

  //#region TypeScript Go

  /**
   * **[Experimental]** Options for the `tsgo` generator.
   *
   * Used when {@link GeneralOptions.generator generator} is `'tsgo'` or
   * TypeScript 7 is detected.
   */
  tsgo?: TsgoOptions

  /**
   * Registers non-standard source languages such as Vue or Astro.
   *
   * If a language is supported via {@link https://volarjs.dev Volar},
   * {@link CustomLanguage.volarTypeScript} and
   * {@link CustomLanguage.createVolarPlugins} are both required. Volar
   * languages require `tsc`; `tsgo` does not support custom languages.
   *
   * @experimental
   */
  customLanguages?: CustomLanguage[]
}

export interface TsgoOptions {
  /** Path to a custom `tsgo` executable. */
  path?: string
}

type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U

export type OptionsResolved = Overwrite<
  Required<Omit<Options, 'compilerOptions' | 'vue' | 'customLanguages'>>,
  {
    entry?: string[]
    tsconfig?: string
    oxc: IsolatedDeclarationsOptions
    tsconfigRaw: TsconfigJson
    tsgo: TsgoOptions
    languageContext: LanguageContext
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
  customLanguages,

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

  customLanguages ||= []
  if (vue) {
    customLanguages.push(createVueLanguage())
  }

  const languageContext = new LanguageContext(customLanguages)
  if (customLanguages.length) {
    // Custom languages that rely on Volar can only be handled by the `tsc`
    // generator; Volar-free languages also work with `oxc`, but `tsgo` does not
    // support custom languages at all.
    if (languageContext.isUsingVolar()) {
      requireTSApi(
        'custom languages',
        '. Custom languages (including the `vue` option) require the TypeScript API.',
      )

      if (generator && generator !== 'tsc') {
        throw new Error(
          'Volar-based custom languages (including the `vue` option) require the `tsc` generator.',
        )
      }
      generator = 'tsc'
    } else if (generator === 'tsgo') {
      throw new Error('The `tsgo` generator does not support custom languages.')
    }
  }

  if (!generator) {
    if (compilerOptions.isolatedDeclarations) {
      generator = 'oxc'
    } else if (isTS70Installed()) {
      if (customLanguages.length) {
        throw new Error(
          "TypeScript 7.0 is installed, but the `tsgo` generator does not support custom languages. Enable `isolatedDeclarations` or set `generator: 'oxc'` to use Oxc instead, or install TypeScript 6.0 or below.",
        )
      }
      generator = 'tsgo'
    } else {
      generator = 'tsc'
    }
  }

  oxc ||= {}
  tsgo ||= {}

  if (generator === 'tsc') {
    requireTSApi(
      'tsc',
      ', or enable `isolatedDeclarations` in your `tsconfig.json` to use Oxc instead.',
    )
  } else if (generator === 'tsgo') {
    if (!tsconfig) {
      throw new Error(
        'The `tsgo` generator requires a tsconfig file to be specified.',
      )
    }
    if (!warnedTsgo) {
      warnedTsgo = true
      logger.warn(
        'TypeScript 7.0 does not yet have a stable API and is experimental. Some options will be unavailable.',
      )
    }
    tsgo.path ??= resolveTsgoPath(logger)
  }
  oxc.stripInternal ??= !!compilerOptions.stripInternal
  // @ts-expect-error omitted in user options
  oxc.sourcemap = !!compilerOptions.declarationMap

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
    languageContext,

    oxc,
    tsgo,
    logger,
  }
  debug('Resolved Options: %O', resolved)

  return resolved
}
