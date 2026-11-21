import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizePath, rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts } from '../../src/index.ts'
import { findSourceMapChunk, fixture } from '../utils.ts'

describe('tsc', () => {
  test('references', async () => {
    const root = fixture('refs')

    const { snapshot } = await rolldownBuild(
      [path.resolve(root, 'src/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.json'),
          compilerOptions: { isolatedDeclarations: false },
          tsc: { build: true },
        }),
      ],
    )

    expect(snapshot).toMatchSnapshot()
  })

  test('compiler project sourcemap (build: false)', async () => {
    const root = fixture('deep-source-map')
    const { snapshot, chunks } = await rolldownBuild(
      [path.resolve(root, 'src/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.json'),
          sourcemap: true,
          tsc: { build: false },
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
    const root = fixture('deep-source-map')
    const { snapshot, chunks } = await rolldownBuild(
      [path.resolve(root, 'src/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.json'),
          sourcemap: true,
          tsc: { build: true },
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

  test('composite projects sourcemap #80', async () => {
    const root = fixture('composite-refs-sourcemap')

    const { chunks } = await rolldownBuild(
      [path.resolve(root, 'src/react/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.react.json'),
          tsc: { build: true },
          sourcemap: true,
          dtsOnly: true,
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

  test('build sourcemap sources point to .ts not .d.ts #255', async () => {
    const root = fixture('build-sourcemap-refs')

    const { chunks } = await rolldownBuild(
      [path.resolve(root, 'src/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.json'),
          tsc: { build: true },
          sourcemap: true,
          dtsOnly: true,
        }),
      ],
      {},
      { dir: path.resolve(root, 'dist') },
    )

    const sourcemap = findSourceMapChunk(chunks, 'index.d.ts.map')
    const sources = (sourcemap.sources || []).toSorted()
    expect(sources).toEqual(['../src/math.ts'])
  })

  test('composite references no incremental', async () => {
    const root = fixture('composite-refs-no-incremental')

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
          tsc: { build: true },
        }),
      ],
    )
    expect(snapshot).toMatchSnapshot()

    // Ensure .tsbuildinfo files are not created after the test
    const tsBuildInfoFiles = await Array.fromAsync(
      fs.glob('**/*.tsbuildinfo', {
        cwd: tempDir,
      }),
    )
    expect(tsBuildInfoFiles).toHaveLength(0)
  })

  test('composite references incremental', async () => {
    const root = fixture('composite-refs-incremental')

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
          tsc: { build: true },
        }),
      ],
    )
    expect(snapshot).toMatchSnapshot()

    // Ensure .tsbuildinfo files are created after the test
    const tsBuildInfoFiles = await Array.fromAsync(
      fs.glob('**/*.tsbuildinfo', {
        cwd: tempDir,
      }),
    )
    expect(tsBuildInfoFiles.map(normalizePath).toSorted())
      .toMatchInlineSnapshot(`
      [
        "dir1/tsconfig.1.tsbuildinfo",
        "dir2/tsconfig.2.tsbuildinfo",
      ]
    `)
  })
})
