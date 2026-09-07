import path from 'node:path'
import { rolldownBuild } from '@sxzz/test-utils'
import { expect, test } from 'vitest'
import { dts } from '../src/index.ts'

const { dirname } = import.meta

test.fails('json import from dts input', async () => {
  const root = path.resolve(dirname, 'fixtures/dts-input-json')
  const { snapshot } = await rolldownBuild(
    path.resolve(root, 'index.d.ts'),
    [dts({ dtsInput: true })],
    { cwd: root },
  )
  expect(snapshot).not.toContain('./data.json')
})

test.fails(
  'typesVersions range that does not match the current TypeScript',
  async () => {
    const root = path.resolve(dirname, 'fixtures/types-versions-range')
    const { snapshot } = await rolldownBuild(
      path.resolve(root, 'index.ts'),
      [dts({ emitDtsOnly: true })],
      { cwd: root },
    )
    expect(snapshot).toContain("'current'")
    expect(snapshot).not.toContain("'legacy'")
  },
)
