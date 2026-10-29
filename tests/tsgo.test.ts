import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldownBuild } from '@sxzz/test-utils'
import { afterEach, expect, test, vi } from 'vitest'
import { LanguageContext } from '../src/custom-language.ts'
import { TsgoGenerator } from '../src/generator/tsgo.ts'
import { dts } from '../src/index.ts'
import { loadTsgoApi, loadTsgoFileSystem } from '../src/tsgo.ts'

const { dirname } = import.meta
const require = createRequire(import.meta.url)

const root = path.resolve(dirname, 'fixtures/tsgo-vfs')
const moduleUrl = import.meta.resolve('typescript-next')
const tsconfig = path.join(root, 'tsconfig.json')
const a = path.join(root, 'a.ts')
const b = path.join(root, 'b.ts')

let generator: TsgoGenerator | undefined

afterEach(async () => {
  await generator?.dispose()
  generator = undefined
  vi.restoreAllMocks()
})

function createGenerator(vfs = true): TsgoGenerator {
  return new TsgoGenerator({
    moduleUrl,
    cwd: root,
    tsconfig,
    vfs,
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

test('concurrent disk emits share configured project membership until the next build', async () => {
  const { Program, Snapshot } = loadTsgoApi(moduleUrl)
  const getSourceFileNames = vi.spyOn(Program.prototype, 'getSourceFileNames')
  const getDefaultProject = vi.spyOn(
    Snapshot.prototype,
    'getDefaultProjectForFile',
  )
  generator = createGenerator(false)
  await generator.init()

  for (let build = 1; build <= 2; build++) {
    const outputs = await Promise.all(
      [a, b, a].map((fileName) => generator!.emit('', fileName)),
    )
    for (const output of outputs) {
      expect(output.error).toBeUndefined()
      expect(output.code).toContain('valueB: number')
    }
    expect(getSourceFileNames).toHaveBeenCalledTimes(build)
    expect(getDefaultProject).not.toHaveBeenCalled()
    await generator.dispose()
    if (build === 1) await generator.init()
  }
})

test('retries configured project membership after a failed request', async () => {
  const { Program } = loadTsgoApi(moduleUrl)
  const getSourceFileNames = vi
    .spyOn(Program.prototype, 'getSourceFileNames')
    .mockRejectedValueOnce(new Error('Failed to load source file names'))
  generator = createGenerator(false)
  await generator.init()

  await expect(generator.emit('', a)).rejects.toThrow(
    'Failed to load source file names',
  )
  expect((await generator.emit('', a)).code).toContain('valueB: number')
  expect(getSourceFileNames).toHaveBeenCalledTimes(2)
})

test('falls back to the default project for a virtual file outside the configured project', async () => {
  const { Snapshot } = loadTsgoApi(moduleUrl)
  const getDefaultProject = vi.spyOn(
    Snapshot.prototype,
    'getDefaultProjectForFile',
  )
  const fileName = path.join(root, 'virtual/outside.ts')
  generator = createGenerator()
  await generator.init()

  const output = await generator.emit('export const outside = 42', fileName)
  expect(output.error).toBeUndefined()
  expect(output.code).toContain('outside = 42')
  expect(getDefaultProject).toHaveBeenCalledExactlyOnceWith(fileName)
})

test('reports a missing project after a configured project cache miss', async () => {
  const { Snapshot } = loadTsgoApi(moduleUrl)
  const getDefaultProject = vi.spyOn(
    Snapshot.prototype,
    'getDefaultProjectForFile',
  )
  const fileName = path.join(root, 'missing.ts')
  generator = createGenerator(false)
  await generator.init()

  const output = await generator.emit('', fileName)
  expect(output.error).toContain(
    `No TypeScript Go project found for ${fileName}`,
  )
  expect(getDefaultProject).toHaveBeenCalledExactlyOnceWith(fileName)
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
  const { Program, Snapshot } = loadTsgoApi(moduleUrl)
  const getSourceFileNames = vi.spyOn(Program.prototype, 'getSourceFileNames')
  const getDefaultProject = vi.spyOn(
    Snapshot.prototype,
    'getDefaultProjectForFile',
  )
  const dependency = path.join(root, 'virtual/nested/dependency.ts')
  const entryCode = "export { value } from './virtual/nested/dependency.ts'\n"
  generator = createGenerator()
  await generator.init()
  await generator.emit(await readFile(a, 'utf8'), a)
  expect(getSourceFileNames).toHaveBeenCalledTimes(1)

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
  expect(getDefaultProject).not.toHaveBeenCalled()
})

test('tsgo with custom path', async () => {
  const getExePath: any = require(
    path.join(path.dirname(fileURLToPath(moduleUrl)), 'getExePath.js'),
  )
  const tsserverPath = (
    typeof getExePath === 'function' ? getExePath : getExePath.default
  )()
  const { snapshot } = await rolldownBuild(
    path.resolve(dirname, 'fixtures/basic.ts'),
    [
      dts({
        generator: 'tsgo',
        tsgo: { moduleUrl, path: tsserverPath },
        tsconfig: path.resolve(dirname, 'fixtures/basic.tsconfig.json'),
      }),
    ],
  )
  expect(snapshot).toMatchSnapshot()
})

test('tsgo vfs uses transformed source code', async () => {
  const input = path.resolve(dirname, 'fixtures/basic.ts')
  const basicTsconfig = path.resolve(dirname, 'fixtures/basic.tsconfig.json')
  const transform = {
    name: 'transform-before-dts',
    transform: {
      order: 'pre' as const,
      handler(code: string, id: string) {
        if (id !== input) return
        return code.replace(
          'export const foo: number = 42',
          "export const foo: 'transformed' = 'transformed'",
        )
      },
    },
  }

  const disk = await rolldownBuild(input, [
    transform,
    dts({
      generator: 'tsgo',
      tsgo: { moduleUrl },
      tsconfig: basicTsconfig,
      emitDtsOnly: true,
    }),
  ])
  const virtual = await rolldownBuild(input, [
    transform,
    dts({
      generator: 'tsgo',
      tsconfig: basicTsconfig,
      emitDtsOnly: true,
      tsgo: { moduleUrl, vfs: true },
    }),
  ])

  expect(disk.snapshot).toContain('foo: number')
  expect(disk.snapshot).not.toContain("foo: 'transformed'")
  expect(virtual.snapshot).toContain("foo: 'transformed'")
})

test.each([false, true])(
  'tsgo vfs infers types from transformed dependencies (circular: %s)',
  async (circular) => {
    const { chunks } = await rolldownBuild(a, [
      {
        name: 'transform-dependency-before-dts',
        transform: {
          order: 'pre',
          handler(_code, id) {
            if (id !== b) return
            return `
            ${circular ? "import { pair } from './a.ts'; export function getPair() { return pair }" : ''}
            export const valueB: string = 'transformed'
          `
          },
        },
      },
      dts({
        generator: 'tsgo',
        tsconfig,
        tsgo: { moduleUrl, vfs: true },
      }),
    ])

    const declaration = chunks
      .filter((chunk) => chunk.type === 'chunk')
      .find((chunk) => chunk.fileName === 'a.d.ts')
    expect(declaration).toBeDefined()
    expect(declaration!.code).toContain('valueB: string')
    expect(declaration!.code).not.toContain('valueB: number')
  },
)
