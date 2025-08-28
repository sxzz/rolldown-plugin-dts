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
            module: 'preserve',
            moduleResolution: 'bundler',
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
          compilerOptions: {
            module: 'preserve',
            moduleResolution: 'bundler',
            isolatedDeclarations: false,
          },
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

  test('should generate correct sourcemaps for a complex composite project with conflicting tsconfig options', async () => {
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

    const sourcemapChunk = chunks.find((chunk) =>
      chunk.fileName.endsWith('.d.ts.map'),
    )
    expect(sourcemapChunk).toBeDefined()
    expect(sourcemapChunk?.type).toBe('asset')

    const sourcemap = JSON.parse((sourcemapChunk as any).source as string)
    const sources: string[] = sourcemap.sources.map((s: string) =>
      s.replaceAll('\\\\', '/'),
    )
    const expectedSources = ['../../src/types.ts', '../../src/react/index.ts']
    expect(sources.sort()).toEqual(expectedSources.sort())
    expect(
      sourcemap.sourcesContent === undefined ||
        (Array.isArray(sourcemap.sourcesContent) &&
          sourcemap.sourcesContent.length === 0),
    ).toBe(true)
  })

  test('composite refs watch propagation', async () => {
    const root = path.resolve(dirname, 'fixtures/composite-refs-sourcemap')

    // Ensure fixture is in baseline state before first build
    const sharedPath = path.resolve(root, 'src/types.ts')
    const reactEntry = path.resolve(root, 'src/react/index.ts')
    let originalShared = await fs.readFile(sharedPath, 'utf8')
    let originalReact = await fs.readFile(reactEntry, 'utf8')
    if (originalShared.includes('export type NewExport')) {
      originalShared = originalShared.replace(
        /\nexport type NewExport[\s\S]*?\n?$/,
        '\n',
      )
      await fs.writeFile(sharedPath, originalShared, 'utf8')
    }
    if (originalReact.includes('export type { NewExport }')) {
      originalReact = originalReact.replace(
        /\nexport type \{ NewExport \} from "\.\.\/types"\n?$/,
        '\n',
      )
      await fs.writeFile(reactEntry, originalReact, 'utf8')
    }

    // First build: react uses shared types
    const { chunks: chunks1 } = await rolldownBuild(
      [path.resolve(root, 'src/react/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.react.json'),
          build: true,
          emitDtsOnly: true,
          parallel: false,
          newContext: true,
        }),
      ],
      {},
      { dir: path.resolve(root, 'actual-output/react') },
    )

    const dtsChunk1 = chunks1.find((c) => c.fileName.endsWith('.d.ts'))!
    const dtsCode1 = (dtsChunk1 as any).code
      ? String((dtsChunk1 as any).code)
      : String((dtsChunk1 as any).source)
    expect(dtsCode1).toContain('export { type Toast')
    expect(dtsCode1).toContain('testValue')

    // Change shared type and re-export it from react entry
    originalShared = await fs.readFile(sharedPath, 'utf8')
    originalReact = await fs.readFile(reactEntry, 'utf8')
    await fs.writeFile(
      sharedPath,
      `${originalShared}\nexport type NewExport = { added: true }\n`,
      'utf8',
    )
    await fs.writeFile(
      reactEntry,
      `${originalReact}\nexport type { NewExport } from "../types"\n`,
      'utf8',
    )

    // Second build: should pick up NewExport in react .d.ts
    const { chunks: chunks2 } = await rolldownBuild(
      [path.resolve(root, 'src/react/index.ts')],
      [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.react.json'),
          build: true,
          emitDtsOnly: true,
          parallel: false,
          newContext: true,
        }),
      ],
      {},
      { dir: path.resolve(root, 'actual-output/react-2') },
    )

    const dtsChunk2 = chunks2.find((c) => c.fileName.endsWith('.d.ts'))!
    const dtsCode2 = (dtsChunk2 as any).code
      ? String((dtsChunk2 as any).code)
      : String((dtsChunk2 as any).source)
    expect(dtsCode2).toContain('export { type NewExport')

    // restore fixture files
    await fs.writeFile(sharedPath, originalShared, 'utf8')
    await fs.writeFile(reactEntry, originalReact, 'utf8')
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
    expect(tsBuildInfoFiles.sort()).toMatchInlineSnapshot(`
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

  test('jsdoc in js', async () => {
    const root = path.resolve(dirname, 'fixtures/jsdoc-js')
    const { snapshot } = await rolldownBuild(path.resolve(root, 'main.js'), [
      dts({
        tsconfig: path.resolve(root, 'tsconfig.json'),
        emitDtsOnly: true,
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test('fail on type errors', async () => {
    await expect(() =>
      rolldownBuild(path.resolve(dirname, 'fixtures/type-error.ts'), [
        dts({
          oxc: false,
        }),
      ]),
    ).rejects.toThrow('error TS2322')
  })
})
