import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts } from '../src/index.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))

test('basic', async () => {
  const { snapshot } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/basic.ts'),
    [dts()],
  )
  expect(snapshot).toMatchSnapshot()
})

test('tsx', async () => {
  const { snapshot } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/tsx.tsx'),
    [dts()],
  )
  expect(snapshot).toMatchSnapshot()
})

test('resolve dependencies', async () => {
  const { snapshot } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/resolve-dep.ts'),
    [
      dts({
        resolve: ['get-tsconfig'],
        oxc: true,
        emitDtsOnly: true,
      }),
    ],
  )
  expect(snapshot).contain('type TsConfigResult')
  expect(snapshot).not.contain('node_modules/rolldown')
})

test('resolve dts', async () => {
  const { snapshot } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/resolve-dts/index.ts'),
    [dts()],
  )
  expect(snapshot).matchSnapshot()
})

// Test alias mapping based on rolldown input option
test('input alias', async () => {
  const root = path.resolve(dirname, 'fixtures/alias')
  const { snapshot, chunks } = await rolldownBuild(
    null!,
    [dts({ emitDtsOnly: false })],
    {
      cwd: root,
      // A mapping from output chunk names to input files. This mapping should
      // be used in both JS and DTS outputs.
      input: {
        output1: 'input1.ts',
        'output2/index': 'input2.ts',
      },
    },
  )
  const fileNames = chunks.map((chunk) => chunk.fileName).sort()

  // The JS output and DTS output should have the same structure
  expect(fileNames).toContain('output1.d.ts')
  expect(fileNames).toContain('output1.js')
  expect(fileNames).toContain('output2/index.d.ts')
  expect(fileNames).toContain('output2/index.js')

  expect(snapshot).toMatchSnapshot()
})

test('isolated declaration error', async () => {
  const error = await rolldownBuild(
    path.resolve(dirname, 'fixtures/isolated-decl-error.ts'),
    [
      dts({
        emitDtsOnly: true,
        oxc: true,
      }),
    ],
  ).catch((error: any) => error)
  expect(String(error)).toContain(
    `Function must have an explicit return type annotation with --isolatedDeclarations.`,
  )
  expect(String(error)).toContain(`export function fn() {`)
})

test('paths', async () => {
  const root = path.resolve(dirname, 'fixtures/paths')
  const { snapshot } = await rolldownBuild(path.resolve(root, 'index.ts'), [
    dts({
      oxc: true,
      emitDtsOnly: true,
      tsconfig: path.resolve(root, 'tsconfig.json'),
    }),
  ])
  expect(snapshot).toMatchSnapshot()
})

test('tree-shaking', async () => {
  const { snapshot } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/tree-shaking/index.ts'),
    [
      dts(),
      {
        name: 'external-node',
        resolveId(id) {
          if (id.startsWith('node:'))
            return { id, external: true, moduleSideEffects: false }
        },
      },
    ],
    { treeshake: true },
  )
  expect(snapshot).matchSnapshot()
})

describe('dts input', () => {
  test('builds', async () => {
    const { snapshot, chunks } = await rolldownBuild(
      null!,
      [dts({ dtsInput: true })],
      {
        input: {
          index: path.resolve(dirname, 'fixtures/dts-input.d.ts'),
        },
      },
    )
    expect(chunks[0].fileName).toBe('index.d.ts')
    expect(snapshot).toMatchSnapshot()
  })

  test('.d in chunk name', async () => {
    const { chunks } = await rolldownBuild(null!, [dts({ dtsInput: true })], {
      input: {
        'index.d': path.resolve(dirname, 'fixtures/dts-input.d.ts'),
      },
    })
    expect(chunks[0].fileName).toBe('index.d.ts')
  })

  test('full extension in chunk name', async () => {
    const { chunks } = await rolldownBuild(null!, [dts({ dtsInput: true })], {
      input: {
        'index.d.mts': path.resolve(dirname, 'fixtures/dts-input.d.ts'),
      },
    })
    expect(chunks[0].fileName).toBe('index.d.mts')
  })

  test('custom entryFileNames with .d', async () => {
    const { chunks } = await rolldownBuild(
      null!,
      [dts({ dtsInput: true })],
      {
        input: {
          index: path.resolve(dirname, 'fixtures/dts-input.d.ts'),
        },
      },
      {
        entryFileNames: '[name].d.cts',
      },
    )
    expect(chunks[0].fileName).toBe('index.d.cts')
  })

  test('custom entryFileNames without .d', async () => {
    const { chunks } = await rolldownBuild(
      null!,
      [dts({ dtsInput: true })],
      {
        input: {
          index: path.resolve(dirname, 'fixtures/dts-input.d.ts'),
        },
      },
      {
        entryFileNames: '[name].mts',
      },
    )
    expect(chunks[0].fileName).toBe('index.d.mts')
  })

  test('custom entryFileNames function', async () => {
    const { chunks } = await rolldownBuild(
      null!,
      [dts({ dtsInput: true })],
      {
        input: {
          index: path.resolve(dirname, 'fixtures/dts-input.d.ts'),
        },
      },
      {
        entryFileNames: () => '[name].mts',
      },
    )
    expect(chunks[0].fileName).toBe('index.d.mts')
  })

  test('invalid entryFileNames gets overridden with stripped .d', async () => {
    const { chunks } = await rolldownBuild(
      null!,
      [dts({ dtsInput: true })],
      {
        input: {
          'index.d': path.resolve(dirname, 'fixtures/dts-input.d.ts'),
        },
      },
      {
        entryFileNames: '[name].invalid',
      },
    )
    expect(chunks[0].fileName).toBe('index.d.ts')
  })

  test('invalid entryFileNames gets overridden and preserves subextension', async () => {
    const { chunks } = await rolldownBuild(
      null!,
      [dts({ dtsInput: true })],
      {
        input: {
          'index.asdf': path.resolve(dirname, 'fixtures/dts-input.d.ts'),
        },
      },
      {
        entryFileNames: '[name].invalid',
      },
    )
    expect(chunks[0].fileName).toBe('index.asdf.d.ts')
  })
})

describe('entryFileNames', () => {
  test('.mjs -> .d.mts', async () => {
    const { chunks } = await rolldownBuild(
      [path.resolve(dirname, 'fixtures/basic.ts')],
      [dts()],
      {},
      {
        entryFileNames: '[name].mjs',
      },
    )

    const chunkNames = chunks.map((chunk) => chunk.fileName).sort()
    expect(chunkNames).toStrictEqual(['basic.d.mts', 'basic.mjs'])
  })

  test('.cjs -> .d.cts', async () => {
    const { chunks } = await rolldownBuild(
      [path.resolve(dirname, 'fixtures/basic.ts')],
      [dts()],
      {},
      {
        entryFileNames: '[name].cjs',
      },
    )

    const chunkNames = chunks.map((chunk) => chunk.fileName).sort()
    expect(chunkNames).toStrictEqual(['basic.cjs', 'basic.d.cts'])
  })

  test('.mjs -> .d.mts with custom chunk name', async () => {
    const { chunks } = await rolldownBuild(
      null!,
      [dts()],
      {
        input: {
          custom: path.resolve(dirname, 'fixtures/basic.ts'),
        },
      },
      {
        entryFileNames: '[name].mjs',
      },
    )

    const chunkNames = chunks.map((chunk) => chunk.fileName).sort()
    expect(chunkNames).toStrictEqual(['custom.d.mts', 'custom.mjs'])
  })

  test('preserves invalid extension', async () => {
    const { chunks } = await rolldownBuild(
      [path.resolve(dirname, 'fixtures/basic.ts')],
      [dts()],
      {},
      {
        entryFileNames: '[name].invalid',
      },
    )

    const chunkNames = chunks.map((chunk) => chunk.fileName).sort()
    expect(chunkNames).toStrictEqual(['basic.d.invalid', 'basic.invalid'])
  })

  test('same-name output (for JS & DTS)', async () => {
    const { chunks } = await rolldownBuild(
      [path.resolve(dirname, 'fixtures/same-name/index.ts')],
      [dts()],
      {},
      {
        preserveModules: true,
        entryFileNames: 'foo.d.ts',
      },
    )

    expect(chunks.every((chunk) => chunk.fileName.endsWith('.d.ts'))).toBe(true)
  })
})

test('type-only export', async () => {
  const { snapshot } = await rolldownBuild(
    [path.resolve(dirname, 'fixtures/type-only-export/index.ts')],
    [dts({ emitDtsOnly: true })],
  )
  expect(snapshot).toMatchSnapshot()
})

test('cjs exports', async () => {
  {
    const { snapshot } = await rolldownBuild(
      [path.resolve(dirname, 'fixtures/cjs-exports.ts')],
      [],
      {},
      { format: 'cjs', exports: 'auto' },
    )
    expect(snapshot).toMatchSnapshot()
  }

  {
    const { snapshot } = await rolldownBuild(
      [path.resolve(dirname, 'fixtures/cjs-exports.ts')],
      [dts({ emitDtsOnly: true, cjsDefault: true })],
    )
    expect(snapshot).toMatchSnapshot()
  }
})

test('should error when file import cannot be found', async () => {
  await expect(() =>
    rolldownBuild(
      path.resolve(dirname, 'fixtures/unresolved-import/index.d.ts'),
      [
        dts({
          emitDtsOnly: true,
        }),
      ],
    ),
  ).rejects.toThrow("Cannot resolve import './missing-file'")
})
