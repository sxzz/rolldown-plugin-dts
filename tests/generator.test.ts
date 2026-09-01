import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resolveOptions, type Options } from '../src/options.ts'
import { mockRequire } from '../src/require.ts'
import type { CustomLanguage } from '../src/custom-language.ts'

const realRequire = createRequire(import.meta.url)

const TYPESCRIPT_MODULE_PATH = '/mock/typescript/lib/typescript.js'
const TYPESCRIPT_MODULE_URL = pathToFileURL(TYPESCRIPT_MODULE_PATH).href
const CUSTOM_MODULE_PATH = '/mock/xxx/lib/index.js'
const CUSTOM_MODULE_URL = pathToFileURL(CUSTOM_MODULE_PATH).href

type PackageVersion = 6 | 7 | 'api' | 'next' | false
type Installed = [ts: PackageVersion, custom: PackageVersion]

function getVersion(version: Exclude<PackageVersion, false>): string {
  if (version === 6) return '6.0.0'
  if (version === 7) return '7.0.2'
  if (version === 'api') return '6.0.0'
  return '7.1.0-dev.20260830.1'
}

function mockInstalled([ts, custom]: Installed) {
  const fake = ((rawId: string) => {
    const id = rawId.replaceAll('\\', '/')
    switch (id) {
      case 'typescript': {
        if (!ts) throw new Error(`Cannot find module 'typescript'`)
        return ts === 6 || ts === 'api' ? { createProgram() {} } : {}
      }
      case TYPESCRIPT_MODULE_PATH:
        if (!ts) throw new Error(`Cannot find module '${id}'`)
        return ts === 6 || ts === 'api' ? { createProgram() {} } : {}
      case CUSTOM_MODULE_PATH:
        if (!custom) throw new Error(`Cannot find module '${id}'`)
        return custom === 6 || custom === 'api' ? { createProgram() {} } : {}
      case 'typescript/package.json':
      case '/mock/typescript/package.json': {
        if (!ts) throw new Error(`Cannot find module '${id}'`)
        return { version: getVersion(ts) }
      }
    }
    const apiSource = ['typescript', 'xxx'].find(
      (source) => id === `/mock/${source}/dist/api/async/api.js`,
    )
    if (apiSource) {
      const installed = apiSource === 'typescript' ? ts : custom
      return {
        API: class {},
        Program:
          installed === 'api' || installed === 'next'
            ? class {
                getDeclarationEmit() {}
              }
            : class {},
      }
    }
    // vue / Volar related modules are loaded for real
    return realRequire(rawId)
  }) as NodeJS.Require
  fake.resolve = ((id: string, options?: { paths?: string[] }) => {
    if (id === 'typescript') {
      if (!ts) throw new Error(`Cannot find module '${id}'`)
      return TYPESCRIPT_MODULE_PATH
    }
    if (id === 'typescript/package.json') {
      if (!ts) throw new Error(`Cannot find module '${id}'`)
      return '/mock/typescript/package.json'
    }
    if (id === 'typescript/unstable/async') {
      const isCustom = options?.paths?.some((value) =>
        value.replaceAll('\\', '/').startsWith('/mock/xxx/'),
      )
      const installed = isCustom ? custom : ts
      if (!installed || installed === 6) {
        throw new Error(`Cannot find module '${id}'`)
      }
      return `/mock/${isCustom ? 'xxx' : 'typescript'}/dist/api/async/api.js`
    }
    return realRequire.resolve(id, options)
  }) as NodeJS.RequireResolve
  mockRequire(fake)
}

afterEach(() => mockRequire())

const TSCONFIG = 'tests/fixtures/basic.tsconfig.json'

const volarLanguage: CustomLanguage = {
  extensionPatterns: [/\.svelte$/],
  volarTypeScript: {} as any,
  createVolarPlugins: () => [],
}
const plainLanguage: CustomLanguage = {
  extensionPatterns: [/\.svg$/],
}

interface Fixture {
  installed?: Installed
  isolatedDecl?: boolean
  oxc?: Options['oxc']
  vue?: boolean
  customLanguages?: Options['customLanguages']
  tsgo?: Options['tsgo']
  generator?: Options['generator']
  tsconfig?: string
  expected: string
  selectedPackage?: string
  isThrow?: boolean
}

function formatTitle(fixture: Fixture): string {
  const [ts, custom] = fixture.installed ?? [6, false]
  const env = [ts ? `ts${ts}` : 'no-ts', custom && 'custom']
    .filter(Boolean)
    .join('+')

  const parts = [env]
  if (fixture.isolatedDecl) parts.push('isolatedDecl')
  if (fixture.oxc !== undefined)
    parts.push(`oxc=${JSON.stringify(fixture.oxc)}`)
  if (fixture.vue) parts.push('vue')
  if (fixture.customLanguages)
    parts.push(
      `langs=[${fixture.customLanguages
        .map((lang) => (lang === volarLanguage ? 'volar' : 'plain'))
        .join(',')}]`,
    )
  if (fixture.tsgo !== undefined)
    parts.push(`tsgo=${JSON.stringify(fixture.tsgo)}`)
  if (fixture.generator) parts.push(`generator=${fixture.generator}`)
  if (fixture.tsconfig) parts.push('tsconfig')

  const result = fixture.isThrow
    ? `throws "${fixture.expected}"`
    : fixture.expected
  return `${parts.join(' ')} => ${result}`
}

describe('resolve generator', () => {
  const fixtures: Fixture[] = [
    //#region inference (no custom language)
    { expected: 'tsc' }, // TS 6 installed by default
    { installed: [6, false], expected: 'tsc' },
    // A custom module does not participate in inference.
    { installed: [6, 'next'], expected: 'tsc' },
    {
      installed: [false, 'next'],
      expected: 'TypeScript is not installed',
      isThrow: true,
    },
    {
      installed: [false, false],
      expected: 'TypeScript is not installed',
      isThrow: true,
    },
    {
      installed: [7, false],
      tsconfig: TSCONFIG,
      expected: 'does not provide the tsgo `getDeclarationEmit` API',
      isThrow: true,
    },
    {
      // A custom module is only used when configured through moduleUrl.
      installed: [7, 'next'],
      tsconfig: TSCONFIG,
      expected: 'does not provide the tsgo `getDeclarationEmit` API',
      isThrow: true,
    },
    { installed: ['next', false], tsconfig: TSCONFIG, expected: 'tsgo' },
    // API capability, rather than the package version, selects tsgo.
    { installed: ['api', false], tsconfig: TSCONFIG, expected: 'tsgo' },
    {
      installed: [7, false],
      expected: 'The `tsgo` generator requires a tsconfig file',
      isThrow: true,
    },
    {
      installed: ['next', false],
      expected: 'The `tsgo` generator requires a tsconfig file',
      isThrow: true,
    },
    //#endregion

    //#region isolatedDeclarations inference
    { installed: [false, false], isolatedDecl: true, expected: 'oxc' },
    { isolatedDecl: true, expected: 'oxc' },
    // isolatedDeclarations takes priority over native compiler inference
    { installed: ['next', 'next'], isolatedDecl: true, expected: 'oxc' },
    //#endregion

    //#region oxc / tsgo settings do not select the generator
    { oxc: {}, expected: 'tsc' },
    { oxc: { stripInternal: true }, expected: 'tsc' },
    { tsgo: {}, expected: 'tsc' },
    { tsgo: { path: '/bin/tsgo' }, expected: 'tsc' },
    { tsgo: { vfs: true }, expected: 'tsc' },
    {
      installed: [6, 'next'],
      tsgo: { moduleUrl: CUSTOM_MODULE_URL },
      expected: 'tsc',
    },
    { oxc: {}, isolatedDecl: true, expected: 'oxc' },
    // Native compiler inference still applies with tsgo settings present.
    {
      installed: ['next', false],
      tsgo: { path: '/bin/tsgo' },
      tsconfig: TSCONFIG,
      expected: 'tsgo',
    },
    //#endregion

    //#region explicit generator
    { generator: 'tsc', expected: 'tsc' },
    {
      installed: [false, false],
      generator: 'tsc',
      expected: 'TypeScript is not installed',
      isThrow: true,
    },
    {
      installed: [7, false],
      generator: 'tsc',
      expected: 'does not provide the classic TypeScript API required by tsc',
      isThrow: true,
    },
    // explicit generator takes priority over inference
    { generator: 'tsc', isolatedDecl: true, expected: 'tsc' },
    { installed: [false, false], generator: 'oxc', expected: 'oxc' },
    { generator: 'oxc', expected: 'oxc' },
    { installed: [7, 'next'], generator: 'oxc', expected: 'oxc' },
    { generator: 'oxc', oxc: { stripInternal: true }, expected: 'oxc' },
    {
      installed: ['next', false],
      generator: 'tsgo',
      tsconfig: TSCONFIG,
      expected: 'tsgo',
      selectedPackage: TYPESCRIPT_MODULE_URL,
    },
    {
      installed: ['next', 'next'],
      generator: 'tsgo',
      tsconfig: TSCONFIG,
      expected: 'tsgo',
      selectedPackage: TYPESCRIPT_MODULE_URL,
    },
    {
      installed: [7, 'next'],
      generator: 'tsgo',
      tsgo: { moduleUrl: CUSTOM_MODULE_URL },
      tsconfig: TSCONFIG,
      expected: 'tsgo',
      selectedPackage: CUSTOM_MODULE_URL,
    },
    {
      installed: [6, 'next'],
      generator: 'tsgo',
      tsgo: { moduleUrl: CUSTOM_MODULE_URL },
      tsconfig: TSCONFIG,
      expected: 'tsgo',
      selectedPackage: CUSTOM_MODULE_URL,
    },
    {
      installed: [6, 7],
      generator: 'tsgo',
      tsgo: { moduleUrl: CUSTOM_MODULE_URL },
      tsconfig: TSCONFIG,
      expected: CUSTOM_MODULE_URL,
      isThrow: true,
    },
    {
      installed: [7, false],
      generator: 'tsgo',
      tsconfig: TSCONFIG,
      expected: 'install `typescript@next`',
      isThrow: true,
    },
    {
      installed: [false, false],
      generator: 'tsgo',
      tsconfig: TSCONFIG,
      expected: 'The TypeScript module does not provide',
      isThrow: true,
    },
    // A custom API server path still requires a package that provides the API.
    {
      installed: [6, 'next'],
      generator: 'tsgo',
      tsgo: {
        moduleUrl: CUSTOM_MODULE_URL,
        path: '/bin/custom-tsserver',
      },
      tsconfig: TSCONFIG,
      expected: 'tsgo',
    },
    {
      installed: [false, false],
      generator: 'tsgo',
      tsgo: { path: '/bin/custom-tsserver' },
      tsconfig: TSCONFIG,
      expected: 'The TypeScript module does not provide',
      isThrow: true,
    },
    {
      generator: 'tsgo',
      expected: 'The `tsgo` generator requires a tsconfig file',
      isThrow: true,
    },
    //#endregion

    //#region vue (Volar-based, requires tsc)
    { vue: true, expected: 'tsc' },
    {
      installed: [false, false],
      vue: true,
      expected: 'TypeScript is not installed',
      isThrow: true,
    },
    {
      installed: [7, false],
      vue: true,
      expected: 'does not provide the classic TypeScript API required by Vue',
      isThrow: true,
    },
    {
      vue: true,
      generator: 'oxc',
      expected: 'require the `tsc` generator',
      isThrow: true,
    },
    {
      vue: true,
      generator: 'tsgo',
      expected: 'require the `tsc` generator',
      isThrow: true,
    },
    {
      installed: ['next', false],
      vue: true,
      generator: 'tsgo',
      expected: 'require the `tsc` generator',
      isThrow: true,
    },
    { vue: true, generator: 'tsc', expected: 'tsc' },
    { vue: true, isolatedDecl: true, expected: 'tsc' },
    // tsgo settings are ignored when tsc is selected
    { installed: [6, 'next'], vue: true, tsgo: {}, expected: 'tsc' },
    //#endregion

    //#region Volar-based custom language (requires tsc)
    { customLanguages: [volarLanguage], expected: 'tsc' },
    {
      installed: [false, false],
      customLanguages: [volarLanguage],
      expected: 'TypeScript is not installed',
      isThrow: true,
    },
    {
      installed: [7, false],
      customLanguages: [volarLanguage],
      expected:
        'does not provide the classic TypeScript API required by custom languages',
      isThrow: true,
    },
    {
      customLanguages: [volarLanguage],
      generator: 'oxc',
      expected: 'require the `tsc` generator',
      isThrow: true,
    },
    {
      customLanguages: [volarLanguage],
      generator: 'tsgo',
      expected: 'require the `tsc` generator',
      isThrow: true,
    },
    { customLanguages: [volarLanguage], isolatedDecl: true, expected: 'tsc' },
    {
      customLanguages: [volarLanguage, plainLanguage],
      vue: true,
      expected: 'tsc',
    },
    //#endregion

    //#region non-Volar custom language
    { customLanguages: [plainLanguage], expected: 'tsc' },
    {
      installed: [false, false],
      customLanguages: [plainLanguage],
      expected: 'TypeScript is not installed',
      isThrow: true,
    },
    { customLanguages: [plainLanguage], isolatedDecl: true, expected: 'oxc' },
    {
      installed: [7, false],
      customLanguages: [plainLanguage],
      tsconfig: TSCONFIG,
      expected: 'requires `tsgo.vfs: true`',
      isThrow: true,
    },
    {
      installed: ['next', false],
      customLanguages: [plainLanguage],
      tsconfig: TSCONFIG,
      expected: 'requires `tsgo.vfs: true`',
      isThrow: true,
    },
    {
      installed: ['next', false],
      customLanguages: [plainLanguage],
      tsgo: { vfs: true },
      tsconfig: TSCONFIG,
      expected: 'tsgo',
    },
    { customLanguages: [plainLanguage], generator: 'tsc', expected: 'tsc' },
    { customLanguages: [plainLanguage], generator: 'oxc', expected: 'oxc' },
    {
      customLanguages: [plainLanguage],
      generator: 'tsgo',
      expected: 'requires `tsgo.vfs: true`',
      isThrow: true,
    },
    {
      installed: [6, 'next'],
      customLanguages: [plainLanguage],
      generator: 'tsgo',
      tsgo: { moduleUrl: CUSTOM_MODULE_URL, vfs: true },
      tsconfig: TSCONFIG,
      expected: 'tsgo',
    },
    // tsgo settings do not select a generator.
    { customLanguages: [plainLanguage], tsgo: {}, expected: 'tsc' },
    //#endregion
  ]

  test.each(
    fixtures.map((fixture) => [formatTitle(fixture), fixture] as const),
  )(
    '%s',
    (
      _title,
      {
        installed = [6, false],
        isolatedDecl,
        oxc,
        vue,
        customLanguages,
        tsgo,
        generator,
        tsconfig,
        expected,
        selectedPackage,
        isThrow,
      },
    ) => {
      mockInstalled(installed)
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const options: Options = {
        tsconfig: tsconfig ?? false,
        compilerOptions: {
          isolatedDeclarations: isolatedDecl,
        },
        oxc,
        vue,
        // resolveOptions may push into the array (e.g. vue), so avoid
        // sharing the same array between fixtures
        customLanguages: customLanguages && [...customLanguages],
        tsgo: tsgo && { ...tsgo },
        generator,
        logger,
      }
      if (isThrow) {
        expect(() => resolveOptions(options)).toThrow(expected)
        return
      }
      const resolved = resolveOptions(options)
      expect(resolved.generator).toBe(expected)
      if (expected === 'tsgo') {
        expect(resolved.tsgo.path).toBe(tsgo?.path)
      }
      expect(resolved.tsgo.moduleUrl).toBe(
        tsgo?.moduleUrl ?? (installed[0] ? TYPESCRIPT_MODULE_URL : undefined),
      )
      expect(resolved.tsgo.vfs).toBe(tsgo?.vfs ?? false)
      if (selectedPackage) {
        expect(logger.info.mock.calls.flat().join(' ')).toContain(
          selectedPackage,
        )
      }
    },
  )
})
