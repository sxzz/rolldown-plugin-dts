import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldownBuild } from '@sxzz/test-utils'
import { expect, test } from 'vitest'
import { dts } from '../src'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(dirname, 'fixtures/resolve-dep')

test('resolve dep', async () => {
  const { snapshot } = await rolldownBuild(path.resolve(root, 'index.ts'), [
    dts({
      resolve: ['magic-string-ast'],
      isolatedDeclaration: true,
      emitDtsOnly: true,
    }),
  ])
  expect(snapshot).toMatchSnapshot()
})
