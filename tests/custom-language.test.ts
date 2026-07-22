import { createRequire } from 'node:module'
import path from 'node:path'
import { getLanguagePlugin } from '@astrojs/ts-plugin/dist/language.js'
import { rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts } from '../src/index.ts'
import type { CustomLanguage } from '../src/custom-language.ts'

const { dirname } = import.meta
const require = createRequire(import.meta.url)

describe('volar', () => {
  describe('vue', () => {
    test('vue-sfc w/ ts-compiler', async () => {
      const root = path.resolve(dirname, 'fixtures/vue-sfc')
      const { snapshot } = await rolldownBuild(
        path.resolve(root, 'main.ts'),
        [
          dts({
            emitDtsOnly: true,
            vue: true,
            compilerOptions: {
              isolatedDeclarations: false,
            },
          }),
        ],
        { external: [/^@vue/] },
      )
      expect(snapshot).toMatchSnapshot()
    })

    test('vue-sfc w/ ts-compiler w/ vueCompilerOptions in tsconfig', async () => {
      const root = path.resolve(dirname, 'fixtures/vue-sfc-fallthrough')
      const { snapshot } = await rolldownBuild(
        path.resolve(root, 'main.ts'),
        [
          dts({
            tsconfig: path.resolve(root, 'tsconfig.json'),
            emitDtsOnly: true,
            vue: true,
          }),
        ],
        { external: ['vue'] },
      )
      expect(snapshot).toMatchSnapshot()
    })

    test('vue-sfc as entries w/o ts importer', async () => {
      const root = path.resolve(dirname, 'fixtures/vue-sfc-entries')
      const { snapshot } = await rolldownBuild(
        [path.resolve(root, 'Foo.vue'), path.resolve(root, 'Bar.vue')],
        [
          dts({
            emitDtsOnly: true,
            vue: true,
            compilerOptions: {
              isolatedDeclarations: false,
            },
          }),
        ],
        { external: [/^@vue/] },
      )
      expect(snapshot).toMatchSnapshot()
    })
  })

  describe('ts-macro', () => {
    const tsMacro = createTsMacroLanguage()

    test('ts-macro w/ ts-compiler', async () => {
      const root = path.resolve(dirname, 'fixtures/ts-macro')
      const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
        dts({
          emitDtsOnly: true,
          tsconfig: path.resolve(root, 'tsconfig.json'),
          customLanguages: [tsMacro],
        }),
      ])
      expect(snapshot).toMatchSnapshot()
    })

    test('vue-sfc w/ ts-macro w/ ts-compiler', async () => {
      const root = path.resolve(dirname, 'fixtures/vue-sfc-with-ts-macro')
      const { snapshot } = await rolldownBuild(
        path.resolve(root, 'main.ts'),
        [
          dts({
            emitDtsOnly: true,
            tsconfig: path.resolve(root, 'tsconfig.json'),
            vue: true,
            customLanguages: [tsMacro],
          }),
        ],
        { external: ['vue'] },
      )
      expect(snapshot).toMatchSnapshot()
    })
  })

  test('astro', async () => {
    const root = path.resolve(dirname, 'fixtures/astro')

    const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
      dts({
        emitDtsOnly: true,
        customLanguages: [createAstroLanguage()],
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test.each(['oxc', 'tsc'] as const)(
    'custom without volar (%s)',
    async (generator) => {
      const root = path.resolve(dirname, 'fixtures/custom-language')

      const RE_CUSTOM = /\.custom$/
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
    extensionPatterns: [/\.astro$/],
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
      return id.replace(/\.astro$/, '.astro.ts')
    },
  }
}
