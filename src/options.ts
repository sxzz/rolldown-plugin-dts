import path from 'node:path'
import process from 'node:process'
import { isDeepStrictEqual } from 'node:util'
import {
  getTsconfig,
  readTsconfig,
  type TsconfigJson,
  type TsconfigJsonResolved,
} from 'get-tsconfig'
import { createDebug } from 'obug'
import { LanguageContext, type CustomLanguage } from './custom-language.ts'
import { resolveTsgoPath } from './generator/tsgo-cli.ts'
import { escapeRegExp } from './regexp.ts'
import { requireTSApi } from './require.ts'
import {
  createVueLanguage,
  createVueLanguageMetadata,
  type VueLanguageOptions,
} from './tsc/vue.ts'
import {
  getDefaultTsgoModuleUrl,
  isLegacyTsgo,
  loadTsgoApi,
  tryLoadTsgoApi,
  type NativeCompiler,
} from './tsgo.ts'
import type { Generator } from './generator/index.ts'
import type { IsolatedDeclarationsOptions } from 'rolldown/experimental'

const debug = createDebug('rolldown-plugin-dts:options')

export interface Logger {
  info: (...args: any[]) => void
  warn: (...args: any[]) => void
  error: (...args: any[]) => void
}

export interface Options extends DeprecatedOptions {
  /**
   * The generator used to produce declaration files.
   *
   * - `'tsc'` supports the full TypeScript type system.
   * - `'oxc'` is faster but requires code compatible with
   *   [`isolatedDeclarations`](https://www.typescriptlang.org/tsconfig/#isolatedDeclarations).
   * - `'tsgo'` uses the experimental TypeScript Go API.
   * - `'tsrs'` uses the highly experimental [tsrs](https://github.com/oxc-project/tsrs)
   *   API, a Rust port of TypeScript Go. Only the latest `tsrs` release is
   *   supported. It is never selected automatically.
   * - A custom {@link Generator} implementation can be provided directly.
   *
   * When omitted, the plugin selects `'oxc'` for `isolatedDeclarations`,
   * `'tsgo'` when TypeScript exposes the declaration emit API or is 7.0
   * (deprecated CLI backend), and `'tsc'` otherwise. Volar-based custom languages require `'tsc'`.
   *
   * @default Inferred from the TypeScript configuration and installed compiler.
   */
  generator?: 'tsc' | 'oxc' | 'tsgo' | 'tsrs' | Generator

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
   * Set to `false` to disable config loading. The `tsgo` generator requires a
   * config file, as does `tsrs`.
   */
  tsconfig?: string | boolean

  /**
   * Raw `tsconfig.json` values merged over the loaded config.
   * The plugin's current `tsgo` implementation does not apply these overrides
   * to the TypeScript program.
   */
  tsconfigRaw?: Omit<TsconfigJson, 'compilerOptions'>

  /**
   * Compiler options merged over those loaded from `tsconfig.json`.
   * In the plugin's current `tsgo` and `tsrs` implementations, these affect plugin behavior
   * but do not override the program's compiler options. Set those options in
   * the config file instead.
   */
  compilerOptions?: TsconfigJson.CompilerOptions

  /**
   * Emits declaration maps (`.d.ts.map`).
   * With `tsgo` or `tsrs`, source mappings also require `compilerOptions.declarationMap`
   * to be enabled in the on-disk config; `sourcemap: true` alone is insufficient.
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
   * **[Highly experimental]** Options for the tsrs generator.
   * Only the latest `tsrs` release is supported.
   */
  tsrs?: TsrsOptions

  /**
   * Registers non-standard source languages such as Vue or Astro.
   *
   * If a language is supported via {@link https://volarjs.dev Volar},
   * {@link CustomLanguage.volarTypeScript} and
   * {@link CustomLanguage.createVolarPlugins} are both required. Volar
   * languages require `tsc`. Non-Volar languages can use `tsgo` together
   * with {@link TsgoOptions.vfs `tsgo.vfs`}, or `tsrs` with
   * {@link TsrsOptions.vfs `tsrs.vfs`}.
   *
   * @experimental
   */
  customLanguages?: CustomLanguage[]
}

interface DeprecatedOptions {
  /** @deprecated Use `tsc.build` instead. */
  build?: TscOptions['build']

  /** @deprecated Use `tsc.incremental` instead. */
  incremental?: TscOptions['incremental']

  /** @deprecated Use `tsc.parallel` instead. */
  parallel?: TscOptions['parallel']

  /** @deprecated Use `tsc.eager` instead. */
  eager?: TscOptions['eager']

  /** @deprecated Use `tsc.newContext` instead. */
  newContext?: TscOptions['newContext']

  /** @deprecated Use `tsc.vue` instead. */
  vue?: TscOptions['vue']
}

export interface TscOptions {
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
   * Allows TypeScript to execute content mappers configured in tsconfig.
   * Cannot be combined with `tsgo.vfs` when content mappers are configured.
   *
   * @default false
   */
  runExternalCode?: boolean

  /**
   * A `file://` URL of the TypeScript module that provides the TypeScript Go API.
   *
   * Use `import.meta.resolve()` to select an npm alias or another compatible
   * TypeScript module.
   *
   * @default import.meta.resolve('typescript')
   */
  moduleUrl?: string

  /**
   * Path passed to the TypeScript Go API as `tsserverPath`.
   * With the deprecated TypeScript 7.0 backend, the `tsgo` executable to run.
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

export interface TsrsOptions {
  /**
   * Allows tsrs to execute content mappers configured in tsconfig.
   * Cannot be combined with `tsrs.vfs` when content mappers are configured.
   *
   * @default false
   */
  runExternalCode?: boolean

  /**
   * A `file://` URL of the `tsrs` package module.
   *
   * @default import.meta.resolve('tsrs')
   */
  moduleUrl?: string

  /**
   * Path to a custom tsrs executable, passed to the API as `tsserverPath`.
   */
  path?: string

  /**
   * Supplies Rolldown-transformed source code to the tsrs API through a
   * virtual filesystem.
   *
   * @default false
   */
  vfs?: boolean
}

type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U

export type OptionsResolved = Overwrite<
  Required<
    Omit<
      Options,
      'compilerOptions' | 'customLanguages' | 'tsc' | keyof DeprecatedOptions
    >
  >,
  {
    entry?: string[]
    tsconfig?: string
    oxc: IsolatedDeclarationsOptions
    tsconfigRaw: TsconfigJson
    tsgo: TsgoOptions
    tsrs: TsrsOptions
    languageContext: LanguageContext
    tsc: Overwrite<Required<TscOptions>, { vue: false | VueLanguageOptions }>
  }
>

const warnedNative = new Set<NativeCompiler>()

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

  emitJs,

  oxc,
  tsgo,
  tsrs,
  ...deprecated
}: Options): OptionsResolved {
  for (const key of [
    'build',
    'incremental',
    'parallel',
    'eager',
    'newContext',
    'vue',
  ] as const) {
    const value = deprecated[key]
    if (value === undefined) continue

    if (tsc?.[key] !== undefined && !isDeepStrictEqual(value, tsc[key])) {
      throw new Error(
        `The deprecated \`${key}\` option conflicts with \`tsc.${key}\`. Remove the top-level \`${key}\` option.`,
      )
    }
    logger.warn(
      `The top-level \`${key}\` option is deprecated. Use \`tsc.${key}\` instead.`,
    )

    // Legacy incremental: false follows tsconfig instead of disabling it.
    if (tsc?.[key] === undefined && (key !== 'incremental' || value)) {
      tsc = { ...tsc, [key]: value }
    }
  }

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

  const vue = tsc?.vue
  const vueOptions: false | VueLanguageOptions = vue
    ? typeof vue === 'object'
      ? vue
      : {}
    : false
  const tscOptions: OptionsResolved['tsc'] = {
    vue: vueOptions,
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
  if (vueOptions) {
    if (generator && generator !== 'tsc') {
      throw new Error(
        'Volar-based custom languages (including the `tsc.vue` option) require the `tsc` generator.',
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
  tsrs ||= {}
  tsrs.moduleUrl ??= getDefaultTsgoModuleUrl('tsrs')
  tsrs.vfs ??= false

  if (isUsingVolar) {
    if (generator && generator !== 'tsc') {
      throw new Error(
        'Volar-based custom languages (including the `tsc.vue` option) require the `tsc` generator.',
      )
    }
    generator = 'tsc'
  }

  if (!generator) {
    if (compilerOptions.isolatedDeclarations) {
      generator = 'oxc'
    } else {
      generator =
        tryLoadTsgoApi(defaultTsgoModuleUrl) ||
        isLegacyTsgo(defaultTsgoModuleUrl)
          ? 'tsgo'
          : 'tsc'
    }
  }

  if (generator === 'tsc' && tscOptions.parallel && hasCustomLanguages) {
    throw new Error(
      'The `tsc.parallel` option does not support `customLanguages`. Disable `tsc.parallel` or use the built-in `tsc.vue` option for Vue.',
    )
  }

  if (isUsingVolar) {
    requireTSApi(
      vueOptions ? 'Vue' : 'custom languages',
      vueOptions ? '.' : '. Custom languages require the TypeScript API.',
    )
  }

  const legacyTsgo = generator === 'tsgo' && isLegacyTsgo(tsgo.moduleUrl)
  if (legacyTsgo && customLanguages.length) {
    throw new Error(
      "The `tsgo` generator on TypeScript 7.0 does not support custom languages. Upgrade to TypeScript >=7.1, enable `isolatedDeclarations` or set `generator: 'oxc'` to use Oxc instead, or install TypeScript 6.0 or below.",
    )
  }

  const native =
    generator === 'tsgo' ? tsgo : generator === 'tsrs' ? tsrs : undefined
  if (customLanguages.length && !isUsingVolar && native && !native.vfs) {
    throw new Error(
      `The \`${generator}\` generator requires \`${generator}.vfs: true\` to process custom languages. Enable VFS, use \`generator: 'oxc'\`, or use a compatible \`tsc\` installation.`,
    )
  }

  if (generator === 'tsc') {
    requireTSApi(
      'tsc',
      ", switch to TypeScript >=7.1 with `generator: 'tsgo'`, or enable `isolatedDeclarations` in your `tsconfig.json` to use Oxc instead.",
    )
  } else if (native) {
    const compiler = generator as NativeCompiler
    if (!tsconfig) {
      throw new Error(
        `The \`${compiler}\` generator requires a tsconfig file to be specified.`,
      )
    }
    if (legacyTsgo) {
      logger.warn(
        'The `tsgo` generator on TypeScript 7.0 is deprecated and will be removed in the next minor. Upgrade to TypeScript 7.1 or later.',
      )
    } else if (!warnedNative.has(compiler)) {
      warnedNative.add(compiler)
      logger.warn(
        compiler === 'tsrs'
          ? 'tsrs support is highly experimental and may change or break without notice. Some options will be unavailable.'
          : 'TypeScript Go is experimental. Some options will be unavailable.',
      )
    }
    if (legacyTsgo) {
      tsgo.path ??= resolveTsgoPath(logger)
    } else {
      loadTsgoApi(native.moduleUrl, logger, compiler)

      const contentMappers: { extensions: string[] }[] | undefined = (
        resolvedTsconfig as any
      )?.contentMappers
      if (contentMappers?.length) {
        if (!native.runExternalCode) {
          throw new Error(
            `Content mappers require \`${compiler}.runExternalCode: true\`.`,
          )
        }
        if (native.vfs) {
          throw new Error(
            `Content mappers cannot be combined with \`${compiler}.vfs\`.`,
          )
        }
        languageContext.contentMapperExtensions = [
          ...new Set(contentMappers.flatMap((mapper) => mapper.extensions)),
        ]
        languageContext.patterns.push(
          ...languageContext.contentMapperExtensions.map(
            (extension) => new RegExp(`${escapeRegExp(extension)}$`),
          ),
        )
      }

      if (sourcemap && !resolvedTsconfig?.compilerOptions?.declarationMap) {
        logger.warn(
          `The \`${compiler}\` generator requires \`compilerOptions.declarationMap: true\` in your tsconfig file for source mappings. The plugin's \`sourcemap\` option does not override the tsconfig.`,
        )
      }
    }
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

    tsc: tscOptions,
    emitJs,
    languageContext,

    oxc,
    tsgo,
    tsrs,
    logger,
  }
  debug('Resolved Options: %O', resolved)

  return resolved
}
