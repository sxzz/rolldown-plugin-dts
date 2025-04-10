import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldownBuild } from '@sxzz/test-utils'
import { expect, test } from 'vitest'
import { dts } from '../src'
import type { OutputChunk } from 'rolldown'

const dirname = path.dirname(fileURLToPath(import.meta.url))

test('resolve dep', async () => {
  const root = path.resolve(dirname, 'fixtures/resolve-dep')

  const { chunks } = await rolldownBuild(path.resolve(root, 'index.ts'), [
    {
      name: 'external-runtime',
      resolveId(id, importer) {
        if (importer?.endsWith('index.ts')) return { id, external: true }
      },
    },
    dts({ resolve: ['magic-string-ast'] }),
  ])
  const chunk = chunks.find(
    (chunk): chunk is OutputChunk => chunk.fileName === 'index.d.ts',
  )
  expect(chunk!.code).toMatchSnapshot()
})
