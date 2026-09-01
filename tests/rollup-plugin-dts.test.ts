/// <reference lib="esnext.array" />

import { glob } from 'node:fs/promises'
import path from 'node:path'
import { rolldownBuild, testFixtures } from '@sxzz/test-utils'
import { expect } from 'vitest'
import { dts } from '../src/index.ts'

await testFixtures(
  'tests/rollup-plugin-dts/**/{index,main-a}.d.ts',
  async (args, id) => {
    const dirname = path.dirname(id)

    let entries = [id]
    if (id.endsWith('main-a.d.ts')) {
      entries = (
        await Array.fromAsync(
          glob('main-*.d.ts', { cwd: dirname, withFileTypes: true }),
        )
      ).map((dirent) => path.resolve(dirname, dirent.name))
    }

    let error: any
    const snapshot = await rolldownBuild(
      entries,
      [
        dts({
          tsconfig: false,
          dtsInput: true,
          sourcemap: false,
        }),
      ],
      {
        treeshake: true,
        external: ['typescript', 'rollup'],
      },
    )
      .then(({ snapshot }) => snapshot)
      .catch((_error) => ((error = _error), undefined))

    if (id.includes('error')) {
      return expect(error).toBeTruthy()
    }

    if (error) throw error
    await expect(snapshot).toMatchFileSnapshot(
      path.resolve(dirname, 'snapshot.d.ts'),
    )
  },
  { snapshot: false },
)
