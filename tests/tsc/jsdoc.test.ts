import path from 'node:path'
import { rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts } from '../../src/index.ts'
import { fixture } from '../utils.ts'

describe('tsc', () => {
  test('jsdoc', async () => {
    const { snapshot } = await rolldownBuild(
      fixture('jsdoc.ts'),
      [dts({ generator: 'tsc' })],
      { external: ['rolldown'] },
    )
    expect(snapshot).toMatchSnapshot()
  })

  test('jsdoc members', async () => {
    const { snapshot } = await rolldownBuild(fixture('jsdoc-members.ts'), [
      dts({ generator: 'tsc' }),
    ])
    expect(snapshot).toMatchSnapshot()
  })

  test('jsdoc in js', async () => {
    const root = fixture('jsdoc-js')
    const { snapshot } = await rolldownBuild(path.resolve(root, 'main.js'), [
      dts({
        tsconfig: path.resolve(root, 'tsconfig.json'),
        dtsOnly: true,
      }),
    ])
    expect(snapshot).toMatchSnapshot()
  })
})
