import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'rolldown'
import { beforeAll, expect, test } from 'vitest'
import { dts } from '../src/index.ts'

const tempDir = path.join(import.meta.dirname, 'temp')
const input = path.resolve(import.meta.dirname, 'fixtures/source-map/index.ts')
const tsconfig = path.resolve(
  import.meta.dirname,
  'fixtures/source-map/tsconfig.no-declaration.json',
)

beforeAll(async () => {
  await rm(path.join(tempDir, 'source-map-tsc-no-declaration'), {
    recursive: true,
    force: true,
  })
})

// Kept out of source-map.test.ts: the tsc generator reuses a cached program per
// entry, so a sibling test with `declaration: true` would hide the crash.
test('tsc with tsconfig declaration=false', async () => {
  const dir = path.join(tempDir, 'source-map-tsc-no-declaration')
  await build({
    input,
    plugins: [
      dts({ generator: 'tsc', tsconfig, sourcemap: true, emitDtsOnly: true }),
    ],
    output: { dir },
    write: true,
  })
  const map = await readFile(path.resolve(dir, 'index.d.ts.map'), 'utf8')
  expect(JSON.parse(map).version).toBe(3)
})
