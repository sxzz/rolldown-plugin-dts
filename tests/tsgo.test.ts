import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { LanguageContext } from '../src/custom-language.ts'
import { TsgoGenerator } from '../src/generator/tsgo.ts'
import { loadTsgoApi, loadTsgoFileSystem } from '../src/tsgo.ts'

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

test.each([
  '',
  fileURLToPath(moduleUrl),
  './node_modules/typescript-next/lib/version.cjs',
  'typescript-next',
  'https://example.com/typescript.js',
  'file:/typescript/lib/version.cjs',
  'file:///invalid%xx',
])('rejects invalid moduleUrl %j', async (invalidModuleUrl) => {
  const message = 'The `tsgo.moduleUrl` option must be a valid file:// URL'
  expect(() => loadTsgoApi(invalidModuleUrl)).toThrow(message)
  expect(() => loadTsgoFileSystem(invalidModuleUrl)).toThrow(message)
  await expect(
    new TsgoGenerator({
      moduleUrl: invalidModuleUrl,
      cwd: root,
      tsconfig,
      vfs: false,
      languageContext: new LanguageContext([]),
    }).init(),
  ).rejects.toThrow(message)
})

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

  const unchanged = await generator.emit(aCode, a)
  expect(unchanged).toEqual(changed)

  await generator.dispose()
  await generator.init()

  const rebuilt = await generator.emit(aCode, a)
  expect(rebuilt.error).toBeUndefined()
  expect(rebuilt.code).toContain('valueB: number')
})

test('vfs uses the specified tsconfig instead of the default project', async () => {
  generator = new TsgoGenerator({
    moduleUrl,
    cwd: root,
    tsconfig: path.join(root, 'tsconfig.build.json'),
    vfs: true,
    languageContext: new LanguageContext([]),
  })
  await generator.init()

  for (const value of [1, 2]) {
    const output = await generator.emit(
      `/** @internal */\nexport const internal = 0\nexport const visible = ${value}\n`,
      a,
    )
    expect(output.error).toBeUndefined()
    expect(output.code).toContain(`visible = ${value}`)
    expect(output.code).not.toContain('internal')
  }
})

test('vfs resolves new files in virtual directories and retains them across updates', async () => {
  const dependency = path.join(root, 'virtual/nested/dependency.ts')
  const entryCode = "export { value } from './virtual/nested/dependency.ts'\n"
  generator = createGenerator()
  await generator.init()

  generator.addFile("export const value = 'virtual' as const\n", dependency)
  const first = await generator.emit(entryCode, a)
  expect(first.error).toBeUndefined()
  expect(first.code).toContain(
    "export { value } from './virtual/nested/dependency.ts'",
  )

  const output = await generator.emit(
    "import { value } from './virtual/nested/dependency.ts'\nexport const copy = value\n",
    a,
  )
  expect(output.error).toBeUndefined()
  expect(output.code).toContain('copy: "virtual"')

  const outputs = await Promise.all([
    generator.emit('export const value = 42 as const\n', dependency),
    generator.emit(
      "import { value } from './virtual/nested/dependency.ts'\nexport const copy = value\n",
      a,
    ),
  ])
  expect(outputs[0].error).toBeUndefined()
  expect(outputs[0].code).toContain('value: 42')
  expect(outputs[1].error).toBeUndefined()
  expect(outputs[1].code).toContain('copy: 42')
})
