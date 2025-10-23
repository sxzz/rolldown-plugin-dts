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
  const fileNames = chunks.map((chunk) => chunk.fileName).toSorted()

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
  test('input array', async () => {
    const { snapshot, chunks } = await rolldownBuild(
      [path.resolve(dirname, 'fixtures/dts-input.d.ts')],
      [dts({ dtsInput: true })],
      {},
    )
    expect(chunks[0].fileName).toBe('dts-input.d.ts')
    expect(snapshot).toMatchSnapshot()
  })

  test('input object', async () => {
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
      [path.resolve(dirname, 'fixtures/dts-input.d.ts')],
      [dts({ dtsInput: true })],
      {},
      {
        entryFileNames: '[name].mts',
      },
    )
    expect(chunks[0].fileName).toBe('dts-input.d.mts')
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

  test('default chunk name', async () => {
    const { snapshot, chunks } = await rolldownBuild(
      [
        path.resolve(dirname, 'fixtures/dts-multi-input/input1.d.ts'),
        path.resolve(dirname, 'fixtures/dts-multi-input/input2.d.ts'),
      ],
      [dts({ dtsInput: true })],
      {},
      {
        entryFileNames: '[name].mts',
      },
    )

    const chunkNames = chunks.map((chunk) => chunk.fileName).toSorted()
    expect(chunkNames).toMatchInlineSnapshot(`
      [
        "input1.d.mts",
        "input2.d.mts",
        "types-B0jSiKC_.d.ts",
      ]
    `)

    expect(snapshot).toMatchSnapshot()
  })

  test('custom chunk name', async () => {
    const { snapshot, chunks } = await rolldownBuild(
      [
        path.resolve(dirname, 'fixtures/dts-multi-input/input1.d.ts'),
        path.resolve(dirname, 'fixtures/dts-multi-input/input2.d.ts'),
      ],
      [dts({ dtsInput: true })],
      {},
      {
        chunkFileNames: 'chunks/[hash]-[name].ts',
      },
    )

    const chunkNames = chunks.map((chunk) => chunk.fileName).toSorted()
    expect(chunkNames).toMatchInlineSnapshot(`
      [
        "chunks/BCXvBysl-types.d.ts",
        "input1.d.ts",
        "input2.d.ts",
      ]
    `)

    expect(snapshot).toMatchSnapshot()
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

    const chunkNames = chunks.map((chunk) => chunk.fileName).toSorted()
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

    const chunkNames = chunks.map((chunk) => chunk.fileName).toSorted()
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

    const chunkNames = chunks.map((chunk) => chunk.fileName).toSorted()
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

    const chunkNames = chunks.map((chunk) => chunk.fileName).toSorted()
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

  test('default chunk name', async () => {
    const { chunks, snapshot } = await rolldownBuild(
      [
        path.resolve(dirname, 'fixtures/alias/input1.ts'),
        path.resolve(dirname, 'fixtures/alias/input2.ts'),
      ],
      [dts({ emitDtsOnly: true })],
      {},
      {
        entryFileNames: '[name].mjs',
      },
    )

    const chunkNames = chunks.map((chunk) => chunk.fileName).toSorted()
    expect(chunkNames).toMatchInlineSnapshot(`
      [
        "input1.d.mts",
        "input2-459dIHr0.d.ts",
        "input2.d.mts",
      ]
    `)

    expect(snapshot).toMatchSnapshot()
  })

  test('custom chunk name', async () => {
    const { snapshot, chunks } = await rolldownBuild(
      [
        path.resolve(dirname, 'fixtures/dts-multi-input/input1.d.ts'),
        path.resolve(dirname, 'fixtures/dts-multi-input/input2.d.ts'),
      ],
      [dts({ emitDtsOnly: true })],
      {},
      {
        chunkFileNames: 'chunks/[hash]-[name].js',
      },
    )

    const chunkNames = chunks.map((chunk) => chunk.fileName).toSorted()
    expect(chunkNames).toMatchInlineSnapshot(`
      [
        "chunks/BCXvBysl-types.d.ts",
        "input1.d.ts",
        "input2.d.ts",
      ]
    `)

    expect(snapshot).toMatchSnapshot()
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

test('declare module', async () => {
  const { snapshot } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/declare-module.ts'),
    [
      dts({
        emitDtsOnly: true,
      }),
    ],
    { platform: 'node' },
  )
  expect(snapshot).toMatchSnapshot()
})

test('should error when file import cannot be found', async () => {
  await expect(() =>
    rolldownBuild(path.resolve(dirname, 'fixtures/unresolved-import/ts.ts'), [
      dts({
        emitDtsOnly: true,
      }),
    ]),
  ).rejects.toThrow("Could not resolve './missing-file'")
})

test('banner', async () => {
  const { snapshot } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/minimal.ts'),
    [
      dts({
        emitDtsOnly: true,
        banner: '/* My Banner */',
        footer: (chunk) => `/* My Footer ${chunk.fileName} */`,
      }),
    ],
  )
  expect(snapshot).toMatchSnapshot()
  expect(snapshot).toContain('/* My Banner */\n')
  expect(snapshot).toContain('\n/* My Footer minimal.d.ts */')
})

test('manualChunks', async () => {
  const { snapshot, chunks } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/manual-chunk/entry.ts'),
    [dts({ emitDtsOnly: true })],
    {},
    {
      manualChunks(id) {
        if (id.includes('shared1')) return 'shared1-chunk.d'
      },
    },
  )
  expect(snapshot).toMatchSnapshot()
  expect(chunks).toHaveLength(2)
})

test('advancedChunks', async () => {
  const { snapshot, chunks } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/manual-chunk/entry.ts'),
    [dts({ emitDtsOnly: true })],
    {},
    {
      advancedChunks: {
        groups: [{ test: /shared1/, name: 'shared1-chunk.d' }],
      },
    },
  )
  expect(snapshot).toMatchSnapshot()
  expect(chunks).toHaveLength(2)
})

test('re-export from lib', async () => {
  const cwd = path.resolve(dirname, 'fixtures/re-export-lib')
  const { snapshot: onlyA } = await rolldownBuild(
    ['a.ts'],
    [dts({ emitDtsOnly: true })],
    { cwd },
  )
  const { snapshot: onlyB } = await rolldownBuild(
    ['b.ts'],
    [dts({ emitDtsOnly: true })],
    { cwd },
  )
  const { snapshot: both } = await rolldownBuild(
    ['a.ts', 'b.ts'],
    [dts({ emitDtsOnly: true })],
    { cwd },
  )
  expect(onlyA).toMatchSnapshot('onlyA')
  expect(onlyB).toMatchSnapshot('onlyB')
  expect(both).toMatchSnapshot('both')
})
