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
import { requireTSApi } from './require.ts'
import {
  createVueLanguage,
  createVueLanguageMetadata,
  type VueLanguageOptions,
} from './tsc/vue.ts'
import {
  getDefaultTsgoModuleUrl,
  getTsgoPackageInfo,
  loadTsgoApi,
} from './tsgo.ts'
import type { Generator } from './generator/index.ts'
import type { IsolatedDeclarationsOptions } from 'rolldown/experimental'

const debug = createDebug('rolldown-plugin-dts:options')

export interface Logger {
  info: (...args: any[]) => void
  warn: (...args: any[]) => void
  error: (...args: any[]) => void
}

export interface Options {
  /**
   * The generator used to produce declaration files.
   *
   * - `'tsc'` supports the full TypeScript type system.
   * - `'oxc'` is faster but requires code compatible with
   *   [`isolatedDeclarations`](https://www.typescriptlang.org/tsconfig/#isolatedDeclarations).
   * - `'tsgo'` uses the experimental TypeScript Go API.
   * - A custom {@link Generator} implementation can be provided directly.
   *
   * When omitted, the plugin selects `'oxc'` for `isolatedDeclarations`,
   * `'tsgo'` when TypeScript exposes the declaration emit API, and `'tsc'`
   * otherwise. Volar-based custom languages require `'tsc'`.
   *
   * @default Inferred from the TypeScript configuration and installed compiler.
   */
  generator?: 'tsc' | 'oxc' | 'tsgo' | Generator

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

  /**
   * Registers the built-in Vue language integration using `vue-tsc`.
   *
   * This is a shortcut for a preconfigured {@link Options.customLanguages}
   * entry and requires the `tsc` generator.
   *
   * @default false
   */
  vue?: boolean | VueLanguageOptions

  /**
   * Generates declarations for JavaScript files with JSDoc types.
   *
   * @default Enabled when `allowJs` or `checkJs` is set.
   */
  emitJs?: boolean

  /** Options for the built-in `tsc` generator. */
  tsc?: TscOptions

  /**
   * Options for the `oxc` generator.
   *
   * The top-level {@link Options.sourcemap sourcemap} option controls
   * declaration maps.
   */
  oxc?: Omit<IsolatedDeclarationsOptions, 'sourcemap'>

  /**
   * **[Experimental]** Options for the TypeScript Go generator.
   */
  tsgo?: TsgoOptions

  /**
   * Registers non-standard source languages such as Vue or Astro.
   *
   * If a language is supported via {@link https://volarjs.dev Volar},
   * {@link CustomLanguage.volarTypeScript} and
   * {@link CustomLanguage.createVolarPlugins} are both required. Volar
   * languages require `tsc`. Non-Volar languages can use `tsgo` together
   * with {@link TsgoOptions.vfs `tsgo.vfs`}.
   *
   * @experimental
   */
  customLanguages?: CustomLanguage[]
}

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
   * Runs `tsc` or `vue-tsc` in a separate process.
   * Custom languages supplied through {@link Options.customLanguages} are not
   * supported in the worker process.
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
}

export interface TsgoOptions {
  /**
   * URL of the TypeScript module that provides the TypeScript Go API.
   *
   * Use `import.meta.resolve()` to select an npm alias or another compatible
   * TypeScript module.
   *
   * @default import.meta.resolve('typescript')
   */
  moduleUrl?: string

  /**
   * Path passed to the TypeScript Go API as `tsserverPath`.
   */
  path?: string

  /**
   * Supplies Rolldown-transformed source code to the `tsgo` API through a
   * virtual filesystem.
   *
   * @default false
   */
  vfs?: boolean
}

type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U

export type OptionsResolved = Overwrite<
  Required<
    Omit<Options, 'compilerOptions' | 'vue' | 'customLanguages' | 'tsc'>
  >,
  {
    entry?: string[]
    tsconfig?: string
    oxc: IsolatedDeclarationsOptions
    tsconfigRaw: TsconfigJson
    tsgo: TsgoOptions
    languageContext: LanguageContext
    vue: false | VueLanguageOptions
    tsc: Required<TscOptions>
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
  tsc,

  vue = false,
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

  sourcemap ??= !!compilerOptions.declarationMap
  compilerOptions.declarationMap = sourcemap

  const tsconfigRaw = {
    ...resolvedTsconfig,
    ...overriddenTsconfigRaw,
    compilerOptions,
  }

  const tscOptions: Required<TscOptions> = {
    build: tsc?.build ?? false,
    incremental:
      tsc?.incremental ??
      !!(compilerOptions.incremental || compilerOptions.tsBuildInfoFile),
    parallel: tsc?.parallel ?? false,
    eager: tsc?.eager ?? false,
    newContext: tsc?.newContext ?? false,
  }

  const hasCustomLanguages = !!customLanguages?.length
  customLanguages = [...(customLanguages || [])]
  const vueOptions: false | VueLanguageOptions = vue
    ? typeof vue === 'object'
      ? vue
      : {}
    : false
  if (vueOptions) {
    if (generator && generator !== 'tsc') {
      throw new Error(
        'Volar-based custom languages (including the `vue` option) require the `tsc` generator.',
      )
    }
    customLanguages.push(
      tscOptions.parallel
        ? createVueLanguageMetadata()
        : createVueLanguage(vueOptions),
    )
  }

  const languageContext = new LanguageContext(customLanguages)
  const isUsingVolar = !!vueOptions || languageContext.isUsingVolar()

  oxc ||= {}
  tsgo ||= {}
  const defaultTsgoModuleUrl = getDefaultTsgoModuleUrl()
  tsgo.moduleUrl ??= defaultTsgoModuleUrl
  tsgo.vfs ??= false

  if (isUsingVolar) {
    if (generator && generator !== 'tsc') {
      throw new Error(
        'Volar-based custom languages (including the `vue` option) require the `tsc` generator.',
      )
    }
    generator = 'tsc'
  }

  if (!generator) {
    if (compilerOptions.isolatedDeclarations) {
      generator = 'oxc'
    } else {
      const pkg = getTsgoPackageInfo(defaultTsgoModuleUrl)
      generator = pkg?.hasTsgoApi ? 'tsgo' : 'tsc'
    }
  }

  if (generator === 'tsc' && tscOptions.parallel && hasCustomLanguages) {
    throw new Error(
      'The `tsc.parallel` option does not support `customLanguages`. Disable `tsc.parallel` or use the built-in `vue` option for Vue.',
    )
  }

  if (isUsingVolar) {
    requireTSApi(
      vueOptions ? 'Vue' : 'custom languages',
      vueOptions ? '.' : '. Custom languages require the TypeScript API.',
    )
  }

  if (
    customLanguages.length &&
    !isUsingVolar &&
    generator === 'tsgo' &&
    !tsgo.vfs
  ) {
    throw new Error(
      "The `tsgo` generator requires `tsgo.vfs: true` to process custom languages. Enable VFS, use `generator: 'oxc'`, or use a compatible `tsc` installation.",
    )
  }

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
        'TypeScript Go is experimental. Some options will be unavailable.',
      )
    }
    loadTsgoApi(tsgo.moduleUrl, logger)
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

    vue: vueOptions,
    tsc: tscOptions,
    emitJs,
    languageContext,

    oxc,
    tsgo,
    logger,
  }
  debug('Resolved Options: %O', resolved)

  return resolved
}
