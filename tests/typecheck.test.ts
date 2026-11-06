import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts, type Options } from '../src/index.ts'

const root = path.resolve(import.meta.dirname, 'fixtures/typecheck')
const entry = path.join(root, 'index.ts')
const tsconfig = path.join(root, 'tsconfig.json')

const config = (name: string) => path.join(root, `${name}.json`)
const tsgo = { moduleUrl: import.meta.resolve('typescript-next') }
const tsrs = { moduleUrl: import.meta.resolve('tsrs') }

// Each case builds its options from a config name, so the `noCheck` variant of
// the config can be tested too.
describe.each<[string, (name: string) => Options]>([
  [
    'tsc',
    (name) => ({
      generator: 'tsc',
      tsconfig: config(name),
      // The shared context would reuse programs of other tests.
      tsc: { newContext: true },
    }),
  ],
  [
    'tsc parallel',
    (name) => ({
      generator: 'tsc',
      tsconfig: config(name),
      tsc: { parallel: true },
    }),
  ],
  [
    'tsc build',
    (name) => ({
      generator: 'tsc',
      tsconfig: config(name.replace('tsconfig', 'tsconfig.build')),
      tsc: { build: true },
    }),
  ],
  ['tsgo', (name) => ({ generator: 'tsgo', tsconfig: config(name), tsgo })],
  [
    'tsgo vfs',
    (name) => ({
      generator: 'tsgo',
      tsconfig: config(name),
      tsgo: { ...tsgo, vfs: true },
    }),
  ],
  ['tsrs', (name) => ({ generator: 'tsrs', tsconfig: config(name), tsrs })],
  [
    'tsrs vfs',
    (name) => ({
      generator: 'tsrs',
      tsconfig: config(name),
      tsrs: { ...tsrs, vfs: true },
    }),
  ],
])('%s', (name, options) => {
  test('ignores type errors by default', async () => {
    const { snapshot } = await rolldownBuild(entry, [
      dts({ ...options('tsconfig'), dtsOnly: true }),
    ])
    expect(snapshot).toContain('declare const value: number')
  })

  test('fails on type errors with `typecheck`', async () => {
    await expect(
      rolldownBuild(entry, [
        dts({ ...options('tsconfig'), dtsOnly: true, typecheck: true }),
      ]),
    ).rejects.toThrow(/error\.ts.*TS2322/s)
  })

  // tsc overrides `noCheck` in memory; the native API reads the config as is.
  const native = name.startsWith('tsgo') || name.startsWith('tsrs')
  test(`${native ? 'rejects' : 'overrides'} a tsconfig \`noCheck\` with \`typecheck\``, async () => {
    await expect(
      rolldownBuild(entry, [
        dts({ ...options('tsconfig.nocheck'), dtsOnly: true, typecheck: true }),
      ]),
    ).rejects.toThrow(
      native
        ? 'The `typecheck` option conflicts with `noCheck`'
        : /error\.ts.*TS2322/s,
    )
  })
})

test.each<[string, Options]>([
  ['tsc eager', { generator: 'tsc', tsc: { eager: true, newContext: true } }],
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
  ['tsc eager', { generator: 'tsc', tsc: { eager: true, newContext: true } }],
  ['tsgo', { generator: 'tsgo', tsgo }],
  ['tsrs', { generator: 'tsrs', tsrs }],
])('%s reports declaration errors', async (_, options) => {
  const fixture = path.resolve(
    import.meta.dirname,
    'fixtures/typecheck-declaration',
  )
  // The error is in a file of the program that emits no declaration.
  await expect(
    rolldownBuild(path.join(fixture, 'entry.ts'), [
      dts({
        ...options,
        tsconfig: path.join(fixture, 'tsconfig.program.json'),
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

test('rejects `typecheck` with oxc', () => {
  expect(() => dts({ generator: 'oxc', tsconfig, typecheck: true })).toThrow(
    'The `typecheck` option is not supported by the `oxc` generator',
  )
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
