import path from 'node:path'
import { rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts } from '../../src/index.ts'
import { fixture } from '../utils.ts'

const external = ['vue', /^@vue/]

describe('volar', () => {
  describe('vue', () => {
    test('vue-sfc w/ ts-compiler', async () => {
      const root = fixture('vue-sfc')
      const { snapshot } = await rolldownBuild(
        path.resolve(root, 'main.ts'),
        [
          dts({
            dtsOnly: true,
            tsc: { vue: true },
            compilerOptions: {
              isolatedDeclarations: false,
            },
          }),
        ],
        { external },
      )
      expect(snapshot).toMatchSnapshot()
    })

    test('vue-sfc w/ parallel ts-compiler', async () => {
      const root = fixture('vue-sfc')
      const { snapshot } = await rolldownBuild(
        path.resolve(root, 'main.ts'),
        [
          dts({
            dtsOnly: true,
            tsc: {
              vue: { vueCompilerOptions: { fallthroughAttributes: false } },
              parallel: true,
            },
            compilerOptions: {
              isolatedDeclarations: false,
            },
          }),
        ],
        { external },
      )
      expect(snapshot).toMatchSnapshot()
    })

    test('vue-sfc w/ ts-compiler w/ vueCompilerOptions in tsconfig', async () => {
      const root = fixture('vue-sfc-fallthrough')
      const { snapshot } = await rolldownBuild(
        path.resolve(root, 'main.ts'),
        [
          dts({
            tsconfig: path.resolve(root, 'tsconfig.json'),
            dtsOnly: true,
            tsc: { vue: true },
          }),
        ],
        { external },
      )
      expect(snapshot).toMatchSnapshot()
    })

    test('vue-sfc as entries w/o ts importer', async () => {
      const root = fixture('vue-sfc-entries')
      const { snapshot } = await rolldownBuild(
        [path.resolve(root, 'Foo.vue'), path.resolve(root, 'Bar.vue')],
        [
          dts({
            dtsOnly: true,
            tsc: { vue: true },
            compilerOptions: {
              isolatedDeclarations: false,
            },
          }),
        ],
        { external },
      )
      expect(snapshot).toMatchSnapshot()
    })
  })
})
