import { access } from 'node:fs/promises'
import path from 'node:path'
import { outputToSnapshot, rollupBuild, testFixtures } from '@sxzz/test-utils'
import { createPatch } from 'diff'
import { build } from 'rolldown'
import { dts as rollupDts } from 'rollup-plugin-dts'
import { expect } from 'vitest'
import { dts } from '../src'

await testFixtures(
  ['tests/fixtures/*/index.d.ts', 'tests/fixtures/local/*/index.d.ts'],
  async (args, id) => {
    const dirname = path.dirname(id)

    const { output } = await build({
      input: [id],
      write: false,
      plugins: [dts()],
    })
    const snapshot = outputToSnapshot(output)
    await expect(snapshot).toMatchFileSnapshot(
      path.resolve(dirname, 'snapshot.d.ts'),
    )

    let { snapshot: rollupSnapshot } = await rollupBuild(
      id,
      [rollupDts()],
      undefined,
      { entryFileNames: '[name].ts' },
    )
    rollupSnapshot = stripEmptyLines(rollupSnapshot)
    const rolldownSnapshot = stripEmptyLines(stripRegion(snapshot))
    const diffPath = path.resolve(dirname, 'diff.patch')
    if (rollupSnapshot !== rolldownSnapshot) {
      const diff = createPatch(
        'diff.patch',
        rollupSnapshot,
        rolldownSnapshot,
        undefined,
        undefined,
        {
          ignoreWhitespace: true,
          ignoreNewlineAtEof: true,
          stripTrailingCr: true,
        },
      )
      await expect(diff).toMatchFileSnapshot(diffPath)
    } else {
      await expect(access(diffPath)).rejects.toThrow()
    }
  },
  { snapshot: false },
)

function stripEmptyLines(text: string) {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n')
}

function stripRegion(text: string) {
  return text
    .replaceAll(/\/\/#region .*\n/g, '')
    .replaceAll('//#endregion\n', '')
}
