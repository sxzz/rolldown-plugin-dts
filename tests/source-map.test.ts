import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { SourceMapConsumer } from '@jridgewell/source-map'
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

function validateSourceMap(sourcemap: string) {
  const map = JSON.parse(sourcemap)
  const consumer = new SourceMapConsumer(map)
  expect(consumer.version).toBe(3)
  expect(consumer.names).toEqual([])
  expect(consumer.file).toBe('index.d.ts')
  expect(consumer.sourcesContent).toBeUndefined()
  expect(consumer.sources).toEqual([
    '../../fixtures/source-map/mod.ts',
    '../../fixtures/source-map/index.ts',
  ])
  const mappings: any[] = []
  consumer.eachMapping((mapping) => {
    mappings.push(mapping)
  })
  expect(mappings.length).toBeGreaterThan(0)
}

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
  const sourcemap = await readFile(path.resolve(dir, 'index.d.ts.map'), 'utf8')
  validateSourceMap(sourcemap)
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
  const sourcemap = await readFile(path.resolve(dir, 'index.d.ts.map'), 'utf8')
  validateSourceMap(sourcemap)
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
  const sourcemap = await readFile(path.resolve(dir, 'index.d.ts.map'), 'utf8')
  validateSourceMap(sourcemap)
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
      "chunk-CzXV76rE.js",
      "index.js.map",
    ]
  `)
})
