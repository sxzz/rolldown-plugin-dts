import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  watch as rolldownWatch,
  type RolldownWatcher,
  type RolldownWatcherEvent,
  type WatchOptions,
} from 'rolldown'
import { describe, expect, test } from 'vitest'
import { dts } from '../src/index.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))

async function waitForBundleEnd(w: RolldownWatcher, timeoutMs = 30000) {
  return await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('watch timed out'))
    }, timeoutMs)
    const onEvent = (event: RolldownWatcherEvent) => {
      if (event.code === 'BUNDLE_END') {
        cleanup()
        resolve()
      } else if (event.code === 'ERROR') {
        cleanup()
        reject(
          event.error instanceof Error ? event.error : new Error('watch error'),
        )
      }
    }
    const handler = onEvent as unknown as Parameters<RolldownWatcher['on']>[1]
    const on = w.on?.bind(w)
    const off = (
      w as unknown as { off?: (e: 'event', h: typeof handler) => void }
    ).off?.bind(w)
    function cleanup() {
      clearTimeout(timer)
      if (off) off('event', handler)
    }
    if (on) on('event', handler)
  })
}

// This test verifies watch-mode propagation end-to-end using rolldown + the dts plugin.
// It builds once, checks the emitted d.ts, then edits source files (adding a new
// type and re-export). The watcher should pick up the changes and rebuild. After
// the rebuild, the new type re-export must appear in the generated index.d.ts.
describe('watch', () => {
  test('watch propagation end-to-end', async () => {
    const root = path.resolve(dirname, 'fixtures/composite-refs-sourcemap')
    const outDir = path.resolve(root, 'dist/react')
    const input = path.resolve(root, 'src/react/index.ts')
    const sharedPath = path.resolve(root, 'src/types.ts')
    const reactEntry = path.resolve(root, 'src/react/index.ts')

    // reset fixture content to baseline
    const originalShared = (await fs.readFile(sharedPath, 'utf8')).replace(
      /\nexport type NewExport[\s\S]*?\n?$/,
      '\n',
    )
    const originalReact = (await fs.readFile(reactEntry, 'utf8')).replace(
      /\nexport type \{ NewExport \} from "\.\.\/types"\n?$/,
      '\n',
    )
    await fs.writeFile(sharedPath, originalShared, 'utf8')
    await fs.writeFile(reactEntry, originalReact, 'utf8')

    const watchOptions: WatchOptions = {
      input,
      plugins: [
        dts({
          tsconfig: path.resolve(root, 'tsconfig.react.json'),
          build: true,
          emitDtsOnly: true,
          // keep single-threaded for stability in tests
          parallel: false,
        }),
      ],
      output: {
        dir: outDir,
      },
    }
    const watcher = rolldownWatch(watchOptions)

    try {
      // first build
      await waitForBundleEnd(watcher)
      const firstDts = await fs.readFile(
        path.resolve(outDir, 'index.d.ts'),
        'utf8',
      )
      expect(firstDts).toContain('export { type Toast')
      expect(firstDts).toContain('testValue')

      // change shared and re-export
      await fs.writeFile(
        sharedPath,
        `${originalShared}\nexport type NewExport = { added: true }\n`,
        'utf8',
      )
      await fs.writeFile(
        reactEntry,
        `${originalReact}\nexport type { NewExport } from "../types"\n`,
        'utf8',
      )

      // next rebuild
      await waitForBundleEnd(watcher)
      const secondDts = await fs.readFile(
        path.resolve(outDir, 'index.d.ts'),
        'utf8',
      )
      expect(secondDts).toContain('export { type NewExport')
    } finally {
      // cleanup
      await (watcher as any).close()
      await fs.writeFile(sharedPath, originalShared, 'utf8')
      await fs.writeFile(reactEntry, originalReact, 'utf8')
    }
  }, 60000)
})
