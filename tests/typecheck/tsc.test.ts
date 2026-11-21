import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rolldownBuild } from '@sxzz/test-utils'
import { expect, test } from 'vitest'
import { dts, type Options } from '../../src/index.ts'
import { fixture } from '../utils.ts'
import { config, describeTypecheck, entry, root } from './shared.ts'

// Loads every file of the tsconfig, not only the ones reached from the entry.
const eager: Options = {
  generator: 'tsc',
  tsc: { eager: true, newContext: true },
}

describeTypecheck('tsc', (name) => ({
  generator: 'tsc',
  tsconfig: config(name),
  // The shared context would reuse programs of other tests.
  tsc: { newContext: true },
}))

describeTypecheck('tsc parallel', (name) => ({
  generator: 'tsc',
  tsconfig: config(name),
  tsc: { parallel: true },
}))

describeTypecheck('tsc build', (name) => ({
  generator: 'tsc',
  tsconfig: config(name.replace('tsconfig', 'tsconfig.build')),
  tsc: { build: true },
}))

test('tsc eager type-checks the whole program', async () => {
  await expect(
    rolldownBuild(entry, [
      dts({
        ...eager,
        tsconfig: config('tsconfig.program'),
        dtsOnly: true,
        typecheck: true,
      }),
    ]),
  ).rejects.toThrow(/unused\.ts.*TS2322/s)
})

test('tsc eager reports declaration errors', async () => {
  const root = fixture('typecheck-declaration')
  // The error is in a file of the program that emits no declaration.
  await expect(
    rolldownBuild(path.join(root, 'entry.ts'), [
      dts({
        ...eager,
        tsconfig: path.join(root, 'tsconfig.program.json'),
        dtsOnly: true,
        typecheck: true,
      }),
    ]),
  ).rejects.toThrow('TS4094')
})

test('tsc does not reuse a cached `noCheck` program with `typecheck`', async () => {
  // A copy keeps the shared context free of programs from other tests.
  const dir = await mkdtemp(path.join(tmpdir(), 'rolldown-plugin-dts-'))
  try {
    await cp(root, dir, { recursive: true })
    const build = (typecheck: boolean) =>
      rolldownBuild(path.join(dir, 'index.ts'), [
        dts({
          generator: 'tsc',
          tsconfig: path.join(dir, 'tsconfig.nocheck.json'),
          dtsOnly: true,
          typecheck,
        }),
      ])
    await build(false)
    await expect(build(true)).rejects.toThrow('TS2322')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('tsc reports type errors of a cached program again', async () => {
  // A copy keeps the shared context free of programs from other tests.
  const dir = await mkdtemp(path.join(tmpdir(), 'rolldown-plugin-dts-'))
  try {
    await cp(root, dir, { recursive: true })
    const build = () =>
      rolldownBuild(path.join(dir, 'index.ts'), [
        dts({
          generator: 'tsc',
          tsconfig: path.join(dir, 'tsconfig.json'),
          dtsOnly: true,
          typecheck: true,
        }),
      ])
    await expect(build()).rejects.toThrow('TS2322')
    await expect(build()).rejects.toThrow('TS2322')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test.each([false, true])(
  'tsc build with `typecheck: %s`',
  async (typecheck) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rolldown-plugin-dts-'))
    try {
      await cp(root, dir, { recursive: true })
      await writeFile(
        path.join(dir, 'tsconfig.build.json'),
        JSON.stringify({
          extends: './tsconfig.json',
          compilerOptions: { incremental: true, outDir: 'dist' },
          include: ['*.ts'],
        }),
      )
      const build = rolldownBuild(path.join(dir, 'index.ts'), [
        dts({
          generator: 'tsc',
          tsconfig: path.join(dir, 'tsconfig.build.json'),
          tsc: { build: true, newContext: true },
          dtsOnly: true,
          typecheck,
        }),
      ])
      if (typecheck) {
        await expect(build).rejects.toThrow('TS2322')
      } else {
        await build
      }

      // `noCheck` leaves type checking pending for the next build.
      const buildInfo = await readFile(
        path.join(dir, 'dist/tsconfig.build.tsbuildinfo'),
        'utf8',
      )
      expect(buildInfo.includes('"checkPending":true')).toBe(!typecheck)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
