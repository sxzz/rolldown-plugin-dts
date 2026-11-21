import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { rolldownBuild } from '@sxzz/test-utils'
import { expect, test } from 'vitest'
import { LanguageContext } from '../../src/custom-language.ts'
import { TsgoGenerator } from '../../src/generator/tsgo.ts'
import { dts, type Options } from '../../src/index.ts'
import { fixture } from '../utils.ts'
import {
  config,
  describeTypecheck,
  entry,
  root,
  tsconfig,
  tsgo,
  tsrs,
} from './shared.ts'
import type { Plugin } from 'rolldown'

describeTypecheck('tsgo', (name) => ({
  generator: 'tsgo',
  tsconfig: config(name),
  tsgo,
}))

describeTypecheck('tsgo vfs', (name) => ({
  generator: 'tsgo',
  tsconfig: config(name),
  tsgo: { ...tsgo, vfs: true },
}))

describeTypecheck('tsrs', (name) => ({
  generator: 'tsrs',
  tsconfig: config(name),
  tsrs,
}))

describeTypecheck('tsrs vfs', (name) => ({
  generator: 'tsrs',
  tsconfig: config(name),
  tsrs: { ...tsrs, vfs: true },
}))

test.each<[string, Options]>([
  ['tsgo', { generator: 'tsgo', tsgo }],
  ['tsrs', { generator: 'tsrs', tsrs }],
])('%s type-checks the whole program', async (_, options) => {
  await expect(
    rolldownBuild(entry, [
      dts({
        ...options,
        tsconfig: config('tsconfig.program'),
        dtsOnly: true,
        typecheck: true,
      }),
    ]),
  ).rejects.toThrow(/unused\.ts.*TS2322/s)
})

test.each<[string, Options]>([
  ['tsgo', { generator: 'tsgo', tsgo }],
  ['tsrs', { generator: 'tsrs', tsrs }],
])('%s reports declaration errors', async (_, options) => {
  const root = fixture('typecheck-declaration')
  // The error is in a file of the program that emits no declaration.
  await expect(
    rolldownBuild(path.join(root, 'entry.ts'), [
      dts({
        ...options,
        tsconfig: path.join(root, 'tsconfig.program.json'),
        dtsOnly: true,
        typecheck: true,
      }),
    ]),
  ).rejects.toThrow('TS4094')
})

test.each([
  ['tsgo', tsgo],
  ['tsrs', tsrs],
] as const)(
  '%s VFS type-checks transformed sources',
  async (compiler, native) => {
    // Fixes the type error of a module that is not an entry.
    const fix: Plugin = {
      name: 'fix-type-error',
      transform: {
        order: 'pre',
        filter: { id: /error\.ts$/ },
        handler: (code) => code.replace("'not a number'", '0'),
      },
    }
    const build = (vfs: boolean) =>
      rolldownBuild(entry, [
        fix,
        dts({
          generator: compiler,
          tsconfig,
          [compiler]: { ...native, vfs },
          dtsOnly: true,
          typecheck: true,
        }),
      ])
    await expect(build(false)).rejects.toThrow('TS2322')
    await build(true)
  },
)

test.each([
  ['tsgo', tsgo],
  ['tsrs', tsrs],
] as const)('%s re-checks programs on rebuilds', async (compiler, native) => {
  const generator = new TsgoGenerator({
    compiler,
    moduleUrl: native.moduleUrl,
    cwd: root,
    tsconfig,
    vfs: true,
    typecheck: true,
    languageContext: new LanguageContext([]),
  })
  const errorFile = path.join(root, 'error.ts')
  const indexCode = await readFile(entry, 'utf8')
  const emit = async (errorCode: string) => {
    await generator.init()
    try {
      generator.addFile(errorCode, errorFile)
      return await generator.emit(indexCode, entry)
    } finally {
      await generator.dispose()
    }
  }

  expect((await emit("export const value: number = ''")).error).toContain(
    'TS2322',
  )
  expect(await emit('export const value: number = 0')).toMatchObject({
    code: expect.stringContaining('value'),
  })
})
