import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { watch as rolldownWatch, type RollupWatcher } from 'rolldown'
import { describe, expect, test } from 'vitest'
import { dts } from '../src/index.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))

async function waitForBundleEnd(w: RollupWatcher, timeoutMs = 30000) {
  return await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('watch timed out'))
    }, timeoutMs)
    const onEvent = (event: any) => {
      if (event.code === 'BUNDLE_END') {
        cleanup()
        resolve()
      } else if (event.code === 'ERROR') {
        cleanup()
        reject(event.error || new Error('watch error'))
      }
    }
    const on = (w as any).on || (w as any).addEventListener
    const off =
      (w as any).off ||
      (w as any).removeEventListener ||
      (w as any).removeListener
    function cleanup() {
      clearTimeout(timer)
      if (off) off.call(w, 'event', onEvent)
    }
    if (on) on.call(w, 'event', onEvent)
  })
}

describe('watch', () => {
  test('watch propagation end-to-end', async () => {
    const root = path.resolve(dirname, 'fixtures/composite-refs-sourcemap')
    const outDir = path.resolve(root, 'actual-watch/react')
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

    const watcher = rolldownWatch({
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
    } as any)

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
