import { createRequire } from 'node:module'
import path from 'node:path'
import { rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts } from '../src/index.ts'
import type { VolarPlugin } from '../src/volar.ts'

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
    const tsMacro = createTsMacroPlugin()

    test('ts-macro w/ ts-compiler', async () => {
      const root = path.resolve(dirname, 'fixtures/ts-macro')
      const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
        dts({
          emitDtsOnly: true,
          tsconfig: path.resolve(root, 'tsconfig.json'),
          volarPlugins: [tsMacro],
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
            volarPlugins: [tsMacro],
          }),
        ],
        { external: ['vue'] },
      )
      expect(snapshot).toMatchSnapshot()
    })
  })
})

function createTsMacroPlugin(): VolarPlugin {
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
    create(ts, options) {
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
