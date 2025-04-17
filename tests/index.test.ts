import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldownBuild } from '@sxzz/test-utils'
import { expect, test } from 'vitest'
import { dts } from '../src'

const dirname = path.dirname(fileURLToPath(import.meta.url))

test('typescript compiler', async () => {
  const root = path.resolve(dirname, 'fixtures/tsc')
  const { snapshot } = await rolldownBuild(
    null!,
    [
      dts({
        emitDtsOnly: true,
        compilerOptions: {},
        isolatedDeclaration: false,
      }),
    ],
    {
      input: [path.resolve(root, 'entry1.ts'), path.resolve(root, 'entry2.ts')],
    },
  )
  expect(snapshot).toMatchSnapshot()
})

test('resolve dependencies', async () => {
  const { snapshot } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/resolve-dep.ts'),
    [
      dts({
        resolve: ['magic-string-ast'],
        isolatedDeclaration: true,
        emitDtsOnly: true,
      }),
    ],
  )
  expect(snapshot).toMatchSnapshot()
})

test('isolated declaration error', async () => {
  const error = await rolldownBuild(
    path.resolve(dirname, 'fixtures/isolated-decl-error.ts'),
    [
      dts({
        emitDtsOnly: true,
        isolatedDeclaration: true,
      }),
    ],
  ).catch((error: any) => error)
  expect(String(error)).toContain(
    `Function must have an explicit return type annotation with --isolatedDeclarations.`,
  )
  expect(String(error)).toContain(`export function fn() {`)
})
