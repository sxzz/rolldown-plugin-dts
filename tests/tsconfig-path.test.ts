import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { rolldownBuild } from '@sxzz/test-utils'
import { expect, test } from 'vitest'
import { dts, type Options } from '../src/index.ts'

const generators: [string, Options][] = [
  ['tsc', { generator: 'tsc', tsc: { newContext: true } }],
  ['tsc build', { generator: 'tsc', tsc: { build: true } }],
  [
    'tsgo',
    {
      generator: 'tsgo',
      tsgo: { moduleUrl: import.meta.resolve('typescript-next') },
    },
  ],
]

for (const [name, options] of generators) {
  for (const explicit of [false, true]) {
    test.each([false, true])(
      `${name} bundles physical sources with an ${explicit ? 'explicit' : 'discovered'} aliased config (file symlink: %s)`,
      async (configSymlink) => {
        const directory = await mkdtemp(
          path.join(tmpdir(), 'dts-config-alias-'),
        )
        try {
          const project = path.join(directory, 'project')
          const alias = path.join(directory, 'alias')
          await mkdir(project)
          const source = path.join(project, 'index.ts')
          await writeFile(source, 'export const value: number = 2')
          const contents = JSON.stringify({
            compilerOptions: { types: [] },
            files: ['index.ts'],
          })
          const config = path.join(project, 'tsconfig.json')
          if (configSymlink) {
            const shared = path.join(directory, 'shared.json')
            await writeFile(shared, contents)
            await symlink(shared, config, 'file')
          } else {
            await writeFile(config, contents)
          }
          await symlink(
            project,
            alias,
            process.platform === 'win32' ? 'junction' : 'dir',
          )
          const { snapshot } = await rolldownBuild(await realpath(source), [
            dts({
              ...options,
              cwd: alias,
              tsconfig: !explicit || 'tsconfig.json',
              dtsOnly: true,
            }),
          ])
          expect(snapshot).toContain('value: number')
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      },
    )
  }
}
