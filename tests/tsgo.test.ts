import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { LanguageContext } from '../src/custom-language.ts'
import { TsgoGenerator } from '../src/generator/tsgo.ts'

const root = path.resolve(import.meta.dirname, 'fixtures/tsgo-vfs')
const moduleUrl = import.meta.resolve('typescript-next')
const tsconfig = path.join(root, 'tsconfig.json')
const a = path.join(root, 'a.ts')
const b = path.join(root, 'b.ts')

let generator: TsgoGenerator | undefined

afterEach(async () => {
  await generator?.dispose()
  generator = undefined
})

function createGenerator(): TsgoGenerator {
  return new TsgoGenerator({
    moduleUrl,
    cwd: root,
    tsconfig,
    vfs: true,
    languageContext: new LanguageContext([]),
  })
}

test('vfs accumulates files, applies changes, and resets between builds', async () => {
  const aCode = await readFile(a, 'utf8')
  generator = createGenerator()
  await generator.init()

  generator.addFile("export const valueB = 'virtual-b' as const\n", b)
  const first = await generator.emit(aCode, a)
  expect(first.error).toBeUndefined()
  expect(first.code).toContain('valueB: "virtual-b"')

  await generator.emit("export const valueB = 'changed-b' as const\n", b)
  const changed = await generator.emit(aCode, a)
  expect(changed.error).toBeUndefined()
  expect(changed.code).toContain('valueB: "changed-b"')

  await generator.dispose()
  generator = createGenerator()
  await generator.init()

  const rebuilt = await generator.emit(aCode, a)
  expect(rebuilt.error).toBeUndefined()
  expect(rebuilt.code).toContain('valueB: number')
})
