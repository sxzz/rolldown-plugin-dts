import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectFilesSnapshot } from '@sxzz/test-utils'
import { build } from 'rolldown'
import { beforeAll, test } from 'vitest'
import { dts } from '../src'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const tempDir = path.join(dirname, 'temp')

beforeAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

test('basic', async () => {
  const dir = path.join(tempDir, 'source-map')
  await build({
    input: path.resolve(dirname, 'fixtures/basic.ts'),
    plugins: [dts({ sourcemap: true, emitDtsOnly: true })],
    output: { dir },
    write: true,
  })
  await expectFilesSnapshot(dir, '__snapshots__/source-map-basic.md')
})
