import fs from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import module, { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import url, { fileURLToPath } from 'node:url'
import { rolldownBuild } from '@sxzz/test-utils'
import { afterEach, expect, test, vi } from 'vitest'
import { LanguageContext } from '../src/custom-language.ts'
import { TsgoCliGenerator } from '../src/generator/tsgo-cli.ts'
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

// typescript-next's getExePath takes the Node modules as an argument
function getTsgoPath(): string {
  const getExePath: any = require(
    path.join(path.dirname(fileURLToPath(moduleUrl)), 'getExePath.js'),
  )
  return (typeof getExePath === 'function' ? getExePath : getExePath.default)({
    fs,
    module,
    path,
    url,
  })
}

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

test('loads the API from an aliased moduleUrl next to another typescript', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rolldown-plugin-dts-'))
  try {
    const writePackage = async (
      name: string,
      files: Record<string, string>,
    ) => {
      for (const [file, content] of Object.entries(files)) {
        const filePath = path.join(dir, 'node_modules', name, file)
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, content)
      }
    }
    await writePackage('typescript', {
      'package.json': JSON.stringify({ name: 'typescript', version: '5.9.3' }),
      'async.js': 'module.exports = { Program: class {} }',
    })
    await writePackage('typescript-next', {
      'package.json': JSON.stringify({
        name: 'typescript',
        version: '7.1.0',
        exports: { '.': './lib/version.cjs', './async': './async.js' },
      }),
      'lib/version.cjs': '',
      'async.js':
        'module.exports = { Program: class { getDeclarationEmit() {} } }',
    })

    const aliasedModuleUrl = url.pathToFileURL(
      path.join(dir, 'node_modules/typescript-next/lib/version.cjs'),
    ).href
    expect(
      loadTsgoApi(aliasedModuleUrl).Program.prototype.getDeclarationEmit,
    ).toBeTypeOf('function')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
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
  const tsserverPath = getTsgoPath()
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
      dtsOnly: true,
    }),
  ])
  const virtual = await rolldownBuild(input, [
    transform,
    dts({
      generator: 'tsgo',
      tsconfig: basicTsconfig,
      dtsOnly: true,
      tsgo: { moduleUrl, vfs: true },
    }),
  ])

  expect(disk.snapshot).toContain('foo: number')
  expect(disk.snapshot).not.toContain("foo: 'transformed'")
  expect(virtual.snapshot).toContain("foo: 'transformed'")
})

test('tsgo vfs infers from transformed dependencies in dtsOnly builds', async () => {
  const fixture = path.resolve(dirname, 'fixtures/tsgo-vfs-dependency')
  const dep = path.join(fixture, 'dep.ts')
  const { snapshot } = await rolldownBuild(path.join(fixture, 'main.ts'), [
    {
      name: 'transform-dependency',
      transform: {
        order: 'pre',
        handler(code, id) {
          if (id !== dep) return
          return code.replace(
            'foo: number = 1',
            "foo: 'transformed' = 'transformed'",
          )
        },
      },
    },
    dts({
      generator: 'tsgo',
      tsconfig: path.join(fixture, 'tsconfig.json'),
      dtsOnly: true,
      tsgo: { moduleUrl, vfs: true },
    }),
  ])
  // `main.d.ts` does not import `dep`, so only preloading the transformed
  // dependency gets this type right.
  expect(snapshot).toContain('declare const bar: "transformed"')
})

test('emits package sources through referenced projects', async () => {
  const fixture = path.resolve(dirname, 'fixtures/tsgo-project-references')
  await Promise.all(
    [
      { consumer: 'app', name: 'model', target: 'lib' },
      { consumer: 'lib', name: 'base', target: 'base' },
    ].map(async ({ consumer, name, target }) => {
      const directory = path.join(fixture, consumer, 'node_modules/@fixture')
      const link = path.join(directory, name)
      await mkdir(directory, { recursive: true })
      await rm(link, { force: true, recursive: true })
      await symlink(path.join(fixture, target), link, 'junction')
    }),
  )
  const { snapshot } = await rolldownBuild(
    path.join(fixture, 'app/src/index.ts'),
    [
      dts({
        generator: 'tsgo',
        tsconfig: path.join(fixture, 'app/tsconfig.json'),
        tsgo: { moduleUrl },
      }),
    ],
  )

  expect(snapshot).toContain('readonly value: string')
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

test('tsgo CLI does not emit next to sources outside the tsconfig directory', async () => {
  const fixture = path.resolve(dirname, 'fixtures/tsgo-outside-root')
  const source = path.join(fixture, 'shared/greet.ts')
  const strayDts = path.join(fixture, 'shared/greet.d.ts')
  const cli = new TsgoCliGenerator({
    tsgoPath: getTsgoPath(),
    tsconfig: path.join(fixture, 'pkg/tsconfig.json'),
    languageContext: new LanguageContext([]),
  })

  await rm(strayDts, { force: true })
  try {
    await cli.init()
    const result = await cli.emit('', source)
    expect(result.code).toContain('interface Greeting')
    expect(fs.existsSync(strayDts)).toBe(false)
  } finally {
    await cli.dispose()
    await rm(strayDts, { force: true })
  }
})

test('tsgo CLI fails on type errors with `typecheck`', async () => {
  const fixture = path.resolve(dirname, 'fixtures/typecheck')
  const options = {
    tsgoPath: getTsgoPath(),
    tsconfig: path.join(fixture, 'tsconfig.json'),
    languageContext: new LanguageContext([]),
  }

  const unchecked = new TsgoCliGenerator(options)
  try {
    await unchecked.init()
    const result = await unchecked.emit('', path.join(fixture, 'error.ts'))
    expect(result.code).toContain('declare const value: number')
  } finally {
    await unchecked.dispose()
  }

  const checked = new TsgoCliGenerator({ ...options, typecheck: true })
  try {
    await expect(checked.init()).rejects.toThrow('tsgo process exited')
  } finally {
    await checked.dispose()
  }
})
