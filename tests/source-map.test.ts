import { rm } from 'node:fs/promises'
import path from 'node:path'
import { expectFilesSnapshot, rolldownBuild } from '@sxzz/test-utils'
import { build } from 'rolldown'
import { beforeAll, expect, test } from 'vitest'
import { dts } from '../src/index.ts'

const tempDir = path.join(import.meta.dirname, 'temp')
const input = path.resolve(import.meta.dirname, 'fixtures/source-map/index.ts')
const tsconfig = path.resolve(
  import.meta.dirname,
  'fixtures/source-map/tsconfig.json',
)

beforeAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

test('oxc', async () => {
  const dir = path.join(tempDir, 'source-map-oxc')
  await build({
    input,
    plugins: [
      dts({
        oxc: true,
        tsconfig,
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
        tsconfig,
        sourcemap: true,
        emitDtsOnly: true,
      }),
    ],
    output: { dir },
    write: true,
  })
  await expectFilesSnapshot(dir, '__snapshots__/source-map-tsc.md')
})

test('tsgo', async () => {
  const dir = path.join(tempDir, 'source-map-tsgo')
  await build({
    input,
    plugins: [
      dts({
        tsgo: true,
        tsconfig,
        sourcemap: true,
        emitDtsOnly: true,
      }),
    ],
    output: { dir },
    write: true,
  })
  await expectFilesSnapshot(dir, '__snapshots__/source-map-tsgo.md')
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
      "index.d.ts",
      "index.js",
      "index.js.map",
    ]
  `)
})
