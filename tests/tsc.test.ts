import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldownBuild } from '@sxzz/test-utils'
import { glob } from 'tinyglobby'
import { describe, expect, test } from 'vitest'
import { dts } from '../src/index.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))

describe('tsc', () => {
  test('typescript compiler', async () => {
    const root = path.resolve(dirname, 'fixtures/tsc')
    const { snapshot } = await rolldownBuild(
      [path.resolve(root, 'entry1.ts'), path.resolve(root, 'entry2.ts')],
      [
        dts({
          emitDtsOnly: true,
          compilerOptions: {
            skipLibCheck: true,
            isolatedDeclarations: false,
          },
          isolatedDeclarations: false,
        }),
      ],
    )
    expect(snapshot.replaceAll(/\/\/#region.*/g, '')).toMatchSnapshot()
  })

  test('multi declarations', async () => {
    const { snapshot } = await rolldownBuild(
      path.resolve(dirname, 'fixtures/multi-decls/index.ts'),
      [
        dts({
          emitDtsOnly: true,
          compilerOptions: { isolatedDeclarations: false },
        }),
      ],
    )
    expect(snapshot).toMatchSnapshot()
  })

  test('composite references', async () => {
    const root = path.resolve(dirname, 'fixtures/composite-refs')

    // The outDir in tsconfig files.
    const tempDir = path.resolve(root, 'temp')

    // Ensure .tsbuildinfo files do not exist before the test
    await fs.rm(tempDir, { recursive: true, force: true })

    const { snapshot } = await rolldownBuild(
      [
        path.resolve(root, 'dir1/input1.ts'),
        path.resolve(root, 'dir2/input2.ts'),
      ],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.json'),
          compilerOptions: { isolatedDeclarations: false },
        }),
      ],
    )
    expect(snapshot).toMatchSnapshot()

    // Ensure .tsbuildinfo files are not created after the test
    const tsBuildInfoFiles = await glob('**/*.tsbuildinfo', {
      cwd: tempDir,
      absolute: false,
    })
    expect(tsBuildInfoFiles).toHaveLength(0)
  })

  test('composite references incremental', async () => {
    const root = path.resolve(dirname, 'fixtures/composite-refs-incremental')

    // The outDir in tsconfig files.
    const tempDir = path.resolve(root, 'temp')

    // Ensure .tsbuildinfo files do not exist before the test
    await fs.rm(tempDir, { recursive: true, force: true })

    const { snapshot } = await rolldownBuild(
      [
        path.resolve(root, 'dir1/input1.ts'),
        path.resolve(root, 'dir2/input2.ts'),
      ],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.json'),
          compilerOptions: { isolatedDeclarations: false },
        }),
      ],
    )
    expect(snapshot).toMatchSnapshot()

    // Ensure .tsbuildinfo files are created after the test
    const tsBuildInfoFiles = await glob('**/*.tsbuildinfo', {
      cwd: tempDir,
      absolute: false,
    })
    expect(tsBuildInfoFiles).toMatchInlineSnapshot(`
    [
      "dir1/tsconfig.1.tsbuildinfo",
      "dir2/tsconfig.2.tsbuildinfo",
    ]
  `)
  })

  test('vue-sfc w/ ts-compiler', async () => {
    const root = path.resolve(dirname, 'fixtures/vue-sfc')
    const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
      dts({
        emitDtsOnly: true,
        vue: true,
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test('jsdoc', async () => {
    const { snapshot } = await rolldownBuild(
      path.resolve(dirname, 'fixtures/jsdoc.ts'),
      [dts({ isolatedDeclarations: false })],
    )
    expect(snapshot).toMatchSnapshot()
  })
})
