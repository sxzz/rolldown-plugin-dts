/// <reference lib="esnext.array" />

import { access, glob, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { rolldownBuild, rollupBuild, testFixtures } from '@sxzz/test-utils'
import { createPatch } from 'diff'
import { dts as rollupDts } from 'rollup-plugin-dts'
import { expect } from 'vitest'
import { dts } from '../src/index.ts'

const isUpdateEnabled =
  process.env.npm_lifecycle_script?.includes('-u') ||
  process.env.npm_lifecycle_script?.includes('--update')

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
    let [rolldownSnapshot, rollupSnapshot] = await Promise.all([
      rolldownBuild(
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
      ).then(({ snapshot }) => snapshot),
      rollupBuild(entries, [rollupDts()], undefined, {
        entryFileNames: '[name].ts',
      })
        .then(({ snapshot }) => snapshot)
        .catch(() => 'rollup-plugin-dts has errors'),
    ]).catch((_error) => ((error = _error), []))

    if (id.includes('error')) {
      return expect(error).toBeTruthy()
    }

    if (error) throw error
    await expect(rolldownSnapshot).toMatchFileSnapshot(
      path.resolve(dirname, 'snapshot.d.ts'),
    )

    rollupSnapshot = cleanupCode(rollupSnapshot)
    rolldownSnapshot = cleanupCode(rolldownSnapshot)
    const diffPath = path.resolve(dirname, 'diff.patch')
    const knownDiffPath = path.resolve(dirname, 'known-diff.patch')
    const diff = createPatch(
      'diff.patch',
      rollupSnapshot,
      rolldownSnapshot,
      undefined,
      undefined,
      {
        ignoreWhitespace: true,
        stripTrailingCr: true,
      },
    )

    // not the same
    if (diff.split('\n').length !== 5) {
      const knownDiff = await readFile(knownDiffPath, 'utf8').catch(() => null)
      if (knownDiff === diff) {
        await unlink(diffPath).catch(() => {})
      } else {
        await expect(diff).toMatchFileSnapshot(
          knownDiff ? knownDiffPath : diffPath,
        )
        await unlink(knownDiff ? diffPath : knownDiffPath).catch(() => {})
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
  return `${text
    .replaceAll(/\/\/#region .*\n/g, '')
    .replaceAll('//#endregion', '')
    .replaceAll(/from "(.*)"/g, "from '$1'")
    .replaceAll('export type', 'export') // FIXME
    .replaceAll(/export \{([^}]*)\}/g, (_, specifiers: string) => {
      return `export {${specifiers.replaceAll(/\btype\s+/g, '')}}`
    })
    .replaceAll(/,$/gm, '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n')
    .replaceAll(/;$/gm, '')
    .trim()}\n`
}
