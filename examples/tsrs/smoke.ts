import assert from 'node:assert/strict'
import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { rolldown } from 'rolldown'
import { Program } from 'tsrs/unstable/async'
import { dts } from '../../src/index.ts'
import { createTsrsGenerator } from './generator.ts'

test('tsrs custom generator', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'dts-tsrs-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const tsconfig = path.join(cwd, 'tsconfig.json')
  const entry = path.join(cwd, 'index.ts')
  const dependency = path.join(cwd, 'dependency.ts')
  const code =
    "import { value } from './dependency.js'; export const copy = value"
  await writeFile(
    tsconfig,
    JSON.stringify({
      compilerOptions: { declaration: true, declarationMap: true },
      include: ['*.ts', '*.mts', '*.cts'],
    }),
  )
  await writeFile(entry, code)
  await writeFile(dependency, 'export const value = 42')

  await t.test(
    'emits bundled declarations and source maps without disk output',
    async () => {
      const build = await rolldown({
        input: entry,
        plugins: dts({
          cwd,
          tsconfig,
          emitDtsOnly: true,
          generator: createTsrsGenerator({ cwd, tsconfig }),
        }),
      })
      try {
        const { output } = await build.generate({ dir: path.join(cwd, 'dist') })
        const declaration = output.find(
          (file) => file.fileName === 'index.d.ts',
        )
        assert.equal(declaration?.type, 'chunk')
        assert.match(declaration.code, /copy = 42/)
        assert.ok(output.some((file) => file.fileName === 'index.d.ts.map'))
        assert.deepEqual((await readdir(cwd)).toSorted(), [
          'dependency.ts',
          'index.ts',
          'tsconfig.json',
        ])
      } finally {
        await build.close()
      }
    },
  )

  await t.test(
    'disk emits can overlap without waiting for earlier requests',
    async (t) => {
      const generator = createTsrsGenerator({ cwd, tsconfig })
      const started = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const originalEmit = Program.prototype.getDeclarationEmit
      let calls = 0
      let outputs: ReturnType<typeof generator.emit>[] = []
      try {
        await generator.init!()
        t.mock.method(
          Program.prototype,
          'getDeclarationEmit',
          async function (
            this: Program,
            ...args: Parameters<typeof originalEmit>
          ) {
            calls++
            started.resolve()
            await release.promise
            return originalEmit.apply(this, args)
          },
        )
        outputs = [generator.emit('', entry), generator.emit('', dependency)]
        await started.promise
        await setImmediate()
        // The second request must reach the API while the first is still blocked.
        assert.equal(calls, 2)
        release.resolve()
        const [entryOutput, dependencyOutput] = await Promise.all(outputs)
        assert.equal(entryOutput.error, undefined)
        assert.equal(dependencyOutput.error, undefined)
        assert.match(entryOutput.code!, /copy = 42/)
        assert.match(dependencyOutput.code!, /value = 42/)
      } finally {
        release.resolve()
        await Promise.allSettled(outputs)
        t.mock.restoreAll()
        await generator.dispose!()
      }
    },
  )

  await t.test(
    'VFS updates dependencies, serializes emits, and resets between builds',
    async () => {
      const generator = createTsrsGenerator({ cwd, tsconfig, vfs: true })
      try {
        await assert.rejects(
          async () => await generator.emit(code, entry),
          /has not been initialized/,
        )
        await generator.init!()
        generator.addFile!(
          "export const value = 'virtual' as const",
          dependency,
        )
        const first = await generator.emit(code, entry)
        assert.equal(first.error, undefined)
        assert.match(first.code!, /copy: "virtual"/)
        assert.deepEqual((first.map as { sources: string[] }).sources, [
          await realpath(entry),
        ])

        const [updated, inferred] = await Promise.all([
          generator.emit("export const value = 'updated' as const", dependency),
          generator.emit(code, entry),
        ])
        assert.match(updated.code!, /value: ['"]updated['"]/)
        assert.match(inferred.code!, /copy: "updated"/)
        assert.equal(
          await readFile(dependency, 'utf8'),
          'export const value = 42',
        )

        await generator.dispose!()
        await writeFile(dependency, 'export const value = 43')
        await generator.init!()
        assert.match((await generator.emit(code, entry)).code!, /copy = 43/)
      } finally {
        await generator.dispose!()
        await generator.dispose!()
      }
    },
  )

  await t.test('emits .d.mts and .d.cts', async () => {
    for (const extension of ['mts', 'cts']) {
      const fileName = path.join(cwd, `module.${extension}`)
      await writeFile(fileName, 'export const value = 1')
      const generator = createTsrsGenerator({ cwd, tsconfig })
      try {
        await generator.init!()
        const result = await generator.emit('', fileName)
        assert.equal(result.error, undefined)
        assert.match(result.code!, /value = 1/)
        assert.ok(result.map)
      } finally {
        await generator.dispose!()
      }
    }
  })

  await t.test('reports declaration diagnostics', async () => {
    const generator = createTsrsGenerator({ cwd, tsconfig, vfs: true })
    try {
      await generator.init!()
      const result = await generator.emit(
        'export const instance = new (class { private secret = 1 })()',
        entry,
      )
      assert.equal(result.code, undefined)
      assert.match(String(result.error), /4094|private|protected/)
    } finally {
      await generator.dispose!()
    }
  })
})
