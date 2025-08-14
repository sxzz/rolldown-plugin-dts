import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldownBuild } from '@sxzz/test-utils'
import { expect, test } from 'vitest'
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

test('dts input', async () => {
  const { snapshot } = await rolldownBuild(null!, [dts({ dtsInput: true })], {
    input: {
      index: path.resolve(dirname, 'fixtures/dts-input.d.ts'),
    },
  })
  expect(snapshot).toMatchSnapshot()
})

test('same-name output', async () => {
  const { chunks } = await rolldownBuild(
    [path.resolve(dirname, 'fixtures/same-name/index.ts')],
    [dts()],
    {},
    { preserveModules: true, entryFileNames: 'foo.d.ts' },
  )
  expect(chunks.every((chunk) => chunk.fileName.endsWith('.d.ts'))).toBe(true)
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
