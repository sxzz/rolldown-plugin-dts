import path from 'node:path'
import { rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts } from '../../src/index.ts'
import { fixture } from '../utils.ts'

describe('tsc', () => {
  test('typescript compiler', async () => {
    const root = fixture('tsc')
    const { snapshot } = await rolldownBuild(
      [path.resolve(root, 'entry1.ts'), path.resolve(root, 'entry2.ts')],
      [
        dts({
          dtsOnly: true,
          compilerOptions: {
            skipLibCheck: true,
            isolatedDeclarations: false,
          },
          generator: 'tsc',
        }),
      ],
    )
    expect(snapshot.replaceAll(/\/\/#region.*/g, '')).toMatchSnapshot()
  })

  test('multi declarations', async () => {
    const { snapshot } = await rolldownBuild(fixture('multi-decls/index.ts'), [
      dts({
        dtsOnly: true,
        compilerOptions: { isolatedDeclarations: false },
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test('arktype', async () => {
    const { snapshot } = await rolldownBuild(
      fixture('arktype.ts'),
      [
        dts({
          compilerOptions: {
            isolatedDeclarations: false,
          },
          dtsOnly: true,
        }),
      ],
      { external: [/^arktype/] },
    )
    expect(snapshot).toMatchSnapshot()
  })

  test('import JSON', async () => {
    const { snapshot } = await rolldownBuild(
      fixture('import-json/index.ts'),
      [
        dts({
          compilerOptions: {
            isolatedDeclarations: false,
          },
          dtsOnly: true,
        }),
      ],
      {
        onwarn(warning) {
          expect.unreachable(warning.message)
        },
      },
    )

    expect(snapshot).toMatchSnapshot()
  })

  test('rename infer', async () => {
    const { snapshot } = await rolldownBuild(
      fixture('infer-renaming.ts'),
      [
        dts({
          compilerOptions: {
            isolatedDeclarations: false,
          },
          dtsOnly: true,
        }),
      ],
      { external: ['zod'] },
    )
    expect(snapshot).toMatchSnapshot()
  })

  test('accessor in type literal', async () => {
    const { snapshot } = await rolldownBuild(
      fixture('accessor-in-type-literal.ts'),
      [
        dts({
          generator: 'tsc',
          dtsOnly: true,
          compilerOptions: { isolatedDeclarations: false },
        }),
      ],
    )
    expect(snapshot).toMatchSnapshot()
  })
})
