import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rolldown } from 'rolldown'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { dts } from '../../src/index.ts'
import { globalContext } from '../../src/tsc/context.ts'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'rolldown-plugin-dts-inputs-'))
  writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        target: 'ES2022',
        types: [],
      },
      include: ['src'],
    }),
  )
  mkdirSync(path.join(dir, 'src'))
  writeFileSync(
    path.join(dir, 'src/shared.ts'),
    'export const shape = { id: 1, tags: ["a"] }\n',
  )
  for (const name of ['a', 'b', 'c']) {
    writeFileSync(
      path.join(dir, `src/${name}.ts`),
      `import { shape } from './shared.ts'\nexport function ${name}() { return { ...shape, ${name}: true as const } }\n`,
    )
  }
})

afterAll(() => {
  rmSync(dir, { force: true, recursive: true })
})

test('builds one program when an entry reaches the plugin late', async () => {
  const delayLateEntry = {
    name: 'delay-late-entry',
    load: {
      order: 'pre' as const,
      async handler(id: string) {
        if (id.endsWith('/src/c.ts')) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
        }
        return null
      },
    },
  }
  const before = globalContext.programs.length

  const bundle = await rolldown({
    cwd: dir,
    input: {
      a: path.join(dir, 'src/a.ts'),
      b: path.join(dir, 'src/b.ts'),
      c: path.join(dir, 'src/c.ts'),
    },
    plugins: [delayLateEntry, dts({ generator: 'tsc', tsconfig: false })],
    logLevel: 'silent',
  })
  await bundle.generate({ format: 'esm' })
  await bundle.close()

  expect(globalContext.programs.length - before).toBe(1)
}, 30_000)
