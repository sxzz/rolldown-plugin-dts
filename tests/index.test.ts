import path from 'node:path'
import { outputToSnapshot } from '@sxzz/test-utils'
import { build } from 'rolldown'
import { expect, test } from 'vitest'
import { dts } from '../src'

test('basic', async () => {
  const { output } = await build({
    input: path.resolve(__dirname, './fixtures/basic/main.d.ts'),
    write: false,
    plugins: [dts()],
  })
  expect(outputToSnapshot(output)).toMatchSnapshot()
})
