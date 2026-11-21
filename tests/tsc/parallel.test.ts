import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'
import { rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts } from '../../src/index.ts'
import { fixture } from '../utils.ts'

describe('tsc', () => {
  test('parallel', async () => {
    const { snapshot } = await rolldownBuild(fixture('basic.ts'), [
      dts({ generator: 'tsc', tsc: { parallel: true } }),
    ])
    expect(snapshot).toContain('export declare const foo: number;')
  })

  test('parallel with pending read on piped stdin', async () => {
    const child = spawn(
      process.execPath,
      [fixture('tsc-parallel-stdin/build.ts')],
      { stdio: ['pipe', 'ignore', 'inherit'] },
    )
    const timer = setTimeout(() => child.kill(), 20_000)
    const [code] = await once(child, 'exit')
    clearTimeout(timer)
    expect(code).toBe(0)
  }, 30_000)
})
