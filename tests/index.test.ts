import { access, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { outputToSnapshot, rollupBuild, testFixtures } from '@sxzz/test-utils'
import { createPatch } from 'diff'
import { build } from 'rolldown'
import { dts as rollupDts } from 'rollup-plugin-dts'
import { expect } from 'vitest'
import { dts } from '../src'

const isUpdateEnabled =
  process.env.npm_lifecycle_script?.includes('-u') ||
  process.env.npm_lifecycle_script?.includes('--update')

await testFixtures(
  ['tests/fixtures/*/index.d.ts', 'tests/fixtures/local/*/index.d.ts'],
  async (args, id) => {
    const dirname = path.dirname(id)

    let [snapshot, rollupSnapshot] = await Promise.all([
      build({
        input: [id],
        write: false,
        plugins: [dts()],
      }).then(({ output }) => outputToSnapshot(output)),
      rollupBuild(id, [rollupDts()], undefined, {
        entryFileNames: '[name].ts',
      }).then(({ snapshot }) => snapshot),
    ])
    await expect(snapshot).toMatchFileSnapshot(
      path.resolve(dirname, 'snapshot.d.ts'),
    )

    rollupSnapshot = cleanupCode(rollupSnapshot)
    const rolldownSnapshot = cleanupCode(snapshot)
    const diffPath = path.resolve(dirname, 'diff.patch')
    const knownDiffPath = path.resolve(dirname, 'known-diff.patch')

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
      const knownDiff = await readFile(knownDiffPath, 'utf8').catch(() => null)
      if (knownDiff !== diff) {
        await expect(diff).toMatchFileSnapshot(diffPath)
        await unlink(knownDiffPath).catch(() => {})
      } else {
        await unlink(diffPath).catch(() => {})
      }
    } else if (isUpdateEnabled) {
      await Promise.all([
        unlink(diffPath).catch(() => {}),
        unlink(knownDiffPath).catch(() => {}),
      ])
    } else {
      await expect(access(diffPath)).rejects.toThrow()
      await expect(access(knownDiffPath)).rejects.toThrow()
    }
  },
  { snapshot: false },
)

function cleanupCode(text: string) {
  return text
    .replaceAll(/\/\/#region .*\n/g, '')
    .replaceAll('//#endregion\n', '')
    .replaceAll(/from "(.*)"/g, "from '$1'")
    .replaceAll('export type', 'export') // FIXME
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n')
}
