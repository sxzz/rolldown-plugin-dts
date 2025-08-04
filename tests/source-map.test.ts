import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectFilesSnapshot, rolldownBuild } from '@sxzz/test-utils'
import { build } from 'rolldown'
import { beforeAll, expect, test } from 'vitest'
import { dts } from '../src/index.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const tempDir = path.join(dirname, 'temp')

beforeAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

const input = path.resolve(dirname, 'fixtures/source-map.ts')

test('oxc', async () => {
  const dir = path.join(tempDir, 'source-map-oxc')
  await build({
    input,
    plugins: [
      dts({
        oxc: true,
        sourcemap: true,
        emitDtsOnly: true,
      }),
    ],
    output: { dir },
    write: true,
  })
  await expectFilesSnapshot(dir, '__snapshots__/source-map-oxc.md')
})

test('tsc', async () => {
  const dir = path.join(tempDir, 'source-map-tsc')
  await build({
    input,
    plugins: [
      dts({
        oxc: false,
        sourcemap: true,
        emitDtsOnly: true,
      }),
    ],
    output: { dir },
    write: true,
  })
  await expectFilesSnapshot(dir, '__snapshots__/source-map-tsc.md')
})

test('disable dts source map only', async () => {
  const { chunks } = await rolldownBuild(
    input,
    [dts({ sourcemap: false })],
    {},
    { sourcemap: true },
  )
  expect(chunks.map((chunk) => chunk.fileName)).toMatchInlineSnapshot(`
    [
      "source-map.d.ts",
      "source-map.js",
      "source-map.js.map",
    ]
  `)
})
