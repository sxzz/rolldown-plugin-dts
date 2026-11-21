import { createRequire } from 'node:module'
import path from 'node:path'
import { getLanguagePlugin } from '@astrojs/ts-plugin/dist/language.js'
import { rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts } from '../../src/index.ts'
import { fixture } from '../utils.ts'
import type { CustomLanguage } from '../../src/custom-language.ts'

const require = createRequire(import.meta.url)
const tsgoModuleUrl = import.meta.resolve('typescript-next')

const external = ['vue', /^@vue/]
const RE_CUSTOM = /\.custom$/
const RE_ASTRO = /\.astro$/

describe('volar', () => {
  describe('ts-macro', () => {
    const tsMacro = createTsMacroLanguage()

    test('ts-macro w/ ts-compiler', async () => {
      const root = fixture('ts-macro')
      const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
        dts({
          dtsOnly: true,
          tsconfig: path.resolve(root, 'tsconfig.json'),
          customLanguages: [tsMacro],
        }),
      ])
      expect(snapshot).toMatchSnapshot()
    })

    test('vue-sfc w/ ts-macro w/ ts-compiler', async () => {
      const root = fixture('vue-sfc-with-ts-macro')
      const { snapshot } = await rolldownBuild(
        path.resolve(root, 'main.ts'),
        [
          dts({
            dtsOnly: true,
            tsconfig: path.resolve(root, 'tsconfig.json'),
            tsc: { vue: true },
            customLanguages: [tsMacro],
          }),
        ],
        { external },
      )
      expect(snapshot).toMatchSnapshot()
    })
  })

  test('astro', async () => {
    const root = fixture('astro')

    const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
      dts({
        dtsOnly: true,
        customLanguages: [createAstroLanguage()],
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test.each(['oxc', 'tsc'] as const)(
    'custom without volar (%s)',
    async (generator) => {
      const root = fixture('custom-language')

      const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
        {
          name: 'convert-custom-to-ts',
          transform: {
            order: 'pre',
            filter: { id: RE_CUSTOM },
            handler: (code) => ({
              code: code.replace('<script>', '').replace('</script>', ''),
              moduleType: 'ts',
            }),
          },
        },
        dts({
          generator,
          customLanguages: [
            {
              extensionPatterns: [RE_CUSTOM],
              tsFileExtensionInfos: [
                {
                  extension: 'custom',
                  isMixedContent: true,
                  scriptKind: 7 /* Deferred */,
                },
              ],
              toTsFilename: (id: string): string =>
                id.replace(RE_CUSTOM, '.custom.ts'),
            },
          ],
        }),
      ])
      expect(snapshot).toMatchSnapshot()
    },
  )

  test('custom without volar (tsgo vfs)', async () => {
    const root = fixture('custom-language')
    const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
      {
        name: 'convert-custom-to-ts',
        transform: {
          order: 'pre',
          filter: { id: RE_CUSTOM },
          handler: (code) => ({
            code: code.replace('<script>', '').replace('</script>', ''),
            moduleType: 'ts',
          }),
        },
      },
      dts({
        generator: 'tsgo',
        tsconfig: path.resolve(root, 'tsconfig.json'),
        sourcemap: true,
        tsgo: { moduleUrl: tsgoModuleUrl, vfs: true },
        customLanguages: [
          {
            extensionPatterns: [RE_CUSTOM],
            toTsFilename: (id) => id.replace(RE_CUSTOM, '.custom.ts'),
          },
        ],
      }),
    ])

    expect(snapshot).toMatchSnapshot()
    expect(snapshot).toContain('declare const foo: string')
  })
})

function createTsMacroLanguage(): CustomLanguage {
  const tsMacroPath = require.resolve('@ts-macro/tsc')
  const volarTypeScript: typeof import('@volar/typescript') = require(
    require.resolve('@volar/typescript', {
      paths: [tsMacroPath],
    }),
  )
  const tsMacro: typeof import('@ts-macro/language-plugin') = require(
    require.resolve('@ts-macro/language-plugin', {
      paths: [tsMacroPath],
    }),
  )
  const { getOptions } = require(
    require.resolve('@ts-macro/language-plugin/options', {
      paths: [tsMacroPath],
    }),
  )

  return {
    extensionPatterns: [],
    tsFileExtensionInfos: [],
    volarTypeScript,
    createVolarPlugins(ts, options) {
      const $rootDir = options.options.$rootDir as string
      const tsMacroLanguagePlugins = tsMacro.getLanguagePlugins(
        ts as any,
        options.options,
        getOptions(ts, $rootDir),
      )
      return tsMacroLanguagePlugins
    },
  }
}

function createAstroLanguage(): CustomLanguage {
  const plugin = getLanguagePlugin()
  return {
    extensionPatterns: [RE_ASTRO],
    tsFileExtensionInfos: [...(plugin.typescript?.extraFileExtensions || [])],
    volarTypeScript: require(
      require.resolve('@volar/typescript', {
        paths: [require.resolve('@astrojs/ts-plugin')],
      }),
    ),
    createVolarPlugins() {
      return [plugin]
    },
    toTsFilename(id: string) {
      return id.replace(RE_ASTRO, '.astro.ts')
    },
  }
}
