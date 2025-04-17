import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldownBuild } from '@sxzz/test-utils'
import { expect, test } from 'vitest'
import { dts } from '../src'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(dirname, 'fixtures/tsc')

test('tsc', async () => {
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
