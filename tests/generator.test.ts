import { createRequire } from 'node:module'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resolveOptions, type Options } from '../src/options.ts'
import { mockRequire } from '../src/require.ts'
import type { CustomLanguage } from '../src/custom-language.ts'

const realRequire = createRequire(import.meta.url)

const MOCK_TSGO_BIN = '/mock/bin/tsgo'
const TSGO_PKGS = ['typescript', '@typescript/native-preview']

type Installed = [ts: 6 | 7 | false, tsgo: boolean]

function mockInstalled([ts, tsgo]: Installed) {
  const fake = ((id: string) => {
    switch (id) {
      case 'typescript': {
        if (!ts) throw new Error(`Cannot find module 'typescript'`)
        return {}
      }
      case 'typescript/package.json':
      case '/mock/typescript/package.json': {
        if (!ts) throw new Error(`Cannot find module '${id}'`)
        return { version: ts === 6 ? '6.0.0' : '7.0.0' }
      }
      case '@typescript/native-preview/package.json':
      case '/mock/@typescript/native-preview/package.json': {
        if (!tsgo) throw new Error(`Cannot find module '${id}'`)
        return { version: '7.0.0-preview' }
      }
    }
    if (TSGO_PKGS.some((pkg) => id === `/mock/${pkg}/lib/getExePath.js`)) {
      return { default: () => MOCK_TSGO_BIN }
    }
    // vue / Volar related modules are loaded for real
    return realRequire(id)
  }) as NodeJS.Require
  fake.resolve = ((id: string, options?: { paths?: string[] }) => {
    if (TSGO_PKGS.some((pkg) => id === `${pkg}/package.json`)) {
      const installed = id.startsWith('typescript') ? ts : tsgo
      if (!installed) throw new Error(`Cannot find module '${id}'`)
      return `/mock/${id}`
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
  isThrow?: boolean
}

function formatTitle(fixture: Fixture): string {
  const [ts, preview] = fixture.installed ?? [6, false]
  const env = [ts ? `ts${ts}` : 'no-ts', preview && 'preview']
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
    // native-preview does not participate in inference
    { installed: [6, true], expected: 'tsc' },
    {
      installed: [false, true],
      expected: 'TypeScript is not installed',
      isThrow: true,
    },
    {
      installed: [false, false],
      expected: 'TypeScript is not installed',
      isThrow: true,
    },
    { installed: [7, false], tsconfig: TSCONFIG, expected: 'tsgo' },
    { installed: [7, true], tsconfig: TSCONFIG, expected: 'tsgo' },
    {
      installed: [7, false],
      expected: 'The `tsgo` generator requires a tsconfig file',
      isThrow: true,
    },
    //#endregion

    //#region isolatedDeclarations inference
    { installed: [false, false], isolatedDecl: true, expected: 'oxc' },
    { isolatedDecl: true, expected: 'oxc' },
    // isolatedDeclarations takes priority over TS 7.0 tsgo inference
    { installed: [7, true], isolatedDecl: true, expected: 'oxc' },
    //#endregion

    //#region oxc / tsgo settings do not select the generator
    { oxc: {}, expected: 'tsc' },
    { oxc: { stripInternal: true }, expected: 'tsc' },
    { tsgo: {}, expected: 'tsc' },
    { tsgo: { path: '/bin/tsgo' }, expected: 'tsc' },
    { oxc: {}, isolatedDecl: true, expected: 'oxc' },
    // TS 7.0 inference still applies with tsgo settings present
    { installed: [7, false], tsgo: {}, tsconfig: TSCONFIG, expected: 'tsgo' },
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
      expected: 'TypeScript 7.0 is not supported when using tsc',
      isThrow: true,
    },
    // explicit generator takes priority over inference
    { generator: 'tsc', isolatedDecl: true, expected: 'tsc' },
    { installed: [false, false], generator: 'oxc', expected: 'oxc' },
    { generator: 'oxc', expected: 'oxc' },
    { installed: [7, true], generator: 'oxc', expected: 'oxc' },
    { generator: 'oxc', oxc: { stripInternal: true }, expected: 'oxc' },
    {
      installed: [7, false],
      generator: 'tsgo',
      tsconfig: TSCONFIG,
      expected: 'tsgo',
    },
    {
      installed: [6, true],
      generator: 'tsgo',
      tsconfig: TSCONFIG,
      expected: 'tsgo',
    },
    {
      installed: [6, true],
      generator: 'tsgo',
      isolatedDecl: true,
      tsconfig: TSCONFIG,
      expected: 'tsgo',
    },
    // tsgo binary is resolved at options-resolution time
    {
      generator: 'tsgo',
      tsconfig: TSCONFIG,
      expected: 'TypeScript Go is not installed',
      isThrow: true,
    },
    {
      installed: [false, false],
      generator: 'tsgo',
      tsconfig: TSCONFIG,
      expected: 'TypeScript Go is not installed',
      isThrow: true,
    },
    // a custom tsgo path skips binary resolution
    {
      installed: [false, false],
      generator: 'tsgo',
      tsgo: { path: '/bin/tsgo' },
      tsconfig: TSCONFIG,
      expected: 'tsgo',
    },
    // the tsconfig requirement is checked before binary resolution
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
      expected: 'TypeScript 7.0 is not supported when using Vue',
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
    { vue: true, generator: 'tsc', expected: 'tsc' },
    { vue: true, isolatedDecl: true, expected: 'tsc' },
    // tsgo settings are ignored when tsc is selected
    { installed: [6, true], vue: true, tsgo: {}, expected: 'tsc' },
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
      expected: 'TypeScript 7.0 is not supported when using custom languages',
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

    //#region non-Volar custom language (oxc allowed, tsgo not)
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
      expected:
        'TypeScript 7.0 is installed, but the `tsgo` generator does not support custom languages',
      isThrow: true,
    },
    { customLanguages: [plainLanguage], generator: 'tsc', expected: 'tsc' },
    { customLanguages: [plainLanguage], generator: 'oxc', expected: 'oxc' },
    {
      customLanguages: [plainLanguage],
      generator: 'tsgo',
      expected: 'The `tsgo` generator does not support custom languages',
      isThrow: true,
    },
    {
      customLanguages: [plainLanguage],
      generator: 'tsgo',
      isolatedDecl: true,
      expected: 'The `tsgo` generator does not support custom languages',
      isThrow: true,
    },
    // tsgo settings are silently ignored with custom languages
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
        expect(resolved.tsgo.path).toBe(tsgo?.path ?? MOCK_TSGO_BIN)
      }
    },
  )
})
