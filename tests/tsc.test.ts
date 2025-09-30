import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldownBuild } from '@sxzz/test-utils'
import { glob } from 'tinyglobby'
import { describe, expect, test } from 'vitest'
import { dts } from '../src/index.ts'
import { findSourceMapChunk } from './utils.ts'

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
          oxc: false,
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

  test('references', async () => {
    const root = path.resolve(dirname, 'fixtures/refs')

    const { snapshot } = await rolldownBuild(
      [path.resolve(root, 'src/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.json'),
          compilerOptions: { isolatedDeclarations: false },
          build: true,
        }),
      ],
    )

    expect(snapshot).toMatchSnapshot()
  })

  test('compiler project sourcemap (build: false)', async () => {
    const root = path.resolve(dirname, 'fixtures/deep-source-map')
    const { snapshot, chunks } = await rolldownBuild(
      [path.resolve(root, 'src/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.json'),
          sourcemap: true,
          build: false,
        }),
      ],
      {},
      { dir: path.resolve(root, 'dist') },
    )
    const sourcemap = findSourceMapChunk(chunks, 'index.d.ts.map')
    expect(sourcemap.sourceRoot).toBeFalsy()
    expect(sourcemap.sources).toMatchInlineSnapshot(`
      [
        "../src/index.ts",
      ]
    `)
    expect(snapshot).toMatchSnapshot()
  })

  test('compiler project sourcemap (build: true)', async () => {
    const root = path.resolve(dirname, 'fixtures/deep-source-map')
    const { snapshot, chunks } = await rolldownBuild(
      [path.resolve(root, 'src/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.json'),
          sourcemap: true,
          build: true,
        }),
      ],
      {},
      { dir: path.resolve(root, 'dist') },
    )
    const sourcemap = findSourceMapChunk(chunks, 'index.d.ts.map')
    expect(sourcemap.sourceRoot).toBeFalsy()
    expect(sourcemap.sources).toMatchInlineSnapshot(`
      [
        "../src/index.d.ts",
      ]
    `)
    expect(snapshot).toMatchSnapshot()
  })

  test('composite projects sourcemap #80', async () => {
    const root = path.resolve(dirname, 'fixtures/composite-refs-sourcemap')

    const { chunks } = await rolldownBuild(
      [path.resolve(root, 'src/react/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.react.json'),
          build: true,
          sourcemap: true,
          emitDtsOnly: true,
        }),
      ],
      {},
      { dir: path.resolve(root, 'actual-output/react') },
    )

    const sourcemap = findSourceMapChunk(chunks, 'index.d.ts.map')
    const sources = sourcemap.sources || []
    const expectedSources = ['../../src/types.ts', '../../src/react/index.ts']
    expect(sources.toSorted()).toEqual(expectedSources.toSorted())
    expect(sourcemap.sourcesContent).toBeOneOf([undefined, []])
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
          build: true,
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
          build: true,
        }),
      ],
    )
    expect(snapshot).toMatchSnapshot()

    // Ensure .tsbuildinfo files are created after the test
    const tsBuildInfoFiles = await glob('**/*.tsbuildinfo', {
      cwd: tempDir,
      absolute: false,
    })
    expect(tsBuildInfoFiles.toSorted()).toMatchInlineSnapshot(`
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
        compilerOptions: {
          isolatedDeclarations: false,
        },
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test('vue-sfc w/ ts-compiler w/ vueCompilerOptions in tsconfig', async () => {
    const root = path.resolve(dirname, 'fixtures/vue-sfc-fallthrough')
    const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
      dts({
        tsconfig: path.resolve(root, 'tsconfig.json'),
        emitDtsOnly: true,
        vue: true,
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test('jsdoc', async () => {
    const { snapshot } = await rolldownBuild(
      path.resolve(dirname, 'fixtures/jsdoc.ts'),
      [dts({ oxc: false })],
    )
    expect(snapshot).toMatchSnapshot()
  })

  test.fails('jsdoc in js', async () => {
    const root = path.resolve(dirname, 'fixtures/jsdoc-js')
    const { snapshot } = await rolldownBuild(path.resolve(root, 'main.js'), [
      dts({
        tsconfig: path.resolve(root, 'tsconfig.json'),
        emitDtsOnly: true,
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test('ts-macro w/ ts-compiler', async () => {
    const root = path.resolve(dirname, 'fixtures/ts-macro')
    const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
      dts({
        emitDtsOnly: true,
        tsconfig: path.resolve(root, 'tsconfig.json'),
        tsMacro: true,
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test('vue-sfc w/ ts-macro w/ ts-compiler', async () => {
    const root = path.resolve(dirname, 'fixtures/vue-sfc-with-ts-macro')
    const { snapshot } = await rolldownBuild(path.resolve(root, 'main.ts'), [
      dts({
        emitDtsOnly: true,
        tsconfig: path.resolve(root, 'tsconfig.json'),
        vue: true,
        tsMacro: true,
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test('arktype', async () => {
    const { snapshot } = await rolldownBuild(
      path.resolve(dirname, 'fixtures/arktype.ts'),
      [
        dts({
          compilerOptions: {
            isolatedDeclarations: false,
          },
          emitDtsOnly: true,
        }),
      ],
    )
    expect(snapshot).toMatchSnapshot()
  })

  test('import JSON', async () => {
    const { snapshot } = await rolldownBuild(
      path.resolve(dirname, 'fixtures/import-json/index.ts'),
      [
        dts({
          compilerOptions: {
            isolatedDeclarations: false,
          },
          emitDtsOnly: true,
        }),
      ],
    )
    expect(snapshot).toMatchSnapshot()
  })
})
