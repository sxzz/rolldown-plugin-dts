import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { SourceMapConsumer } from '@jridgewell/source-map'
import { expectFilesSnapshot, rolldownBuild } from '@sxzz/test-utils'
import { build } from 'rolldown'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { dts } from '../src/index.ts'

const tempDir = path.join(import.meta.dirname, 'temp')
const input = path.resolve(import.meta.dirname, 'fixtures/source-map/index.ts')
const tsconfig = path.resolve(
  import.meta.dirname,
  'fixtures/source-map/tsconfig.json',
)
const tsgoModuleUrl = import.meta.resolve('typescript-next')

beforeAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

function validateSourceMap(sourcemap: string) {
  const map = JSON.parse(sourcemap)
  const consumer = new SourceMapConsumer(map)
  expect(consumer.version).toBe(3)
  expect(consumer.names).toEqual([])
  expect(consumer.file).toBe('index.d.ts')
  expect(consumer.sourcesContent).toBeUndefined()
  expect(consumer.sources).toEqual([
    '../../fixtures/source-map/mod.ts',
    '../../fixtures/source-map/index.ts',
  ])
  const mappings: any[] = []
  consumer.eachMapping((mapping) => {
    mappings.push(mapping)
  })
  expect(mappings.length).toBeGreaterThan(0)
}

test('oxc', async () => {
  const dir = path.join(tempDir, 'source-map-oxc')
  await build({
    input,
    plugins: [
      dts({
        generator: 'oxc',
        tsconfig,
        sourcemap: true,
        dtsOnly: true,
      }),
    ],
    output: { dir },
    write: true,
  })
  await expectFilesSnapshot(dir, '__snapshots__/source-map-oxc.md')
  const sourcemap = await readFile(path.resolve(dir, 'index.d.ts.map'), 'utf8')
  validateSourceMap(sourcemap)
})

test.each([true, false])(
  'tsc with tsconfig declaration=%s',
  async (declaration) => {
    const dir = path.join(tempDir, 'source-map-tsc')
    await build({
      input,
      plugins: [
        dts({
          generator: 'tsc',
          tsc: { newContext: true },
          tsconfig,
          compilerOptions: { declaration },
          sourcemap: true,
          dtsOnly: true,
        }),
      ],
      output: { dir },
      write: true,
    })
    await expectFilesSnapshot(dir, '__snapshots__/source-map-tsc.md')
    const sourcemap = await readFile(
      path.resolve(dir, 'index.d.ts.map'),
      'utf8',
    )
    validateSourceMap(sourcemap)
  },
)

test('tsgo', async () => {
  const dir = path.join(tempDir, 'source-map-tsgo')
  await build({
    input,
    plugins: [
      dts({
        generator: 'tsgo',
        tsgo: { moduleUrl: tsgoModuleUrl },
        tsconfig,
        sourcemap: true,
        dtsOnly: true,
      }),
    ],
    output: { dir },
    write: true,
  })
  await expectFilesSnapshot(dir, '__snapshots__/source-map-tsgo.md')
  const sourcemap = await readFile(path.resolve(dir, 'index.d.ts.map'), 'utf8')
  validateSourceMap(sourcemap)
})

test.each([true, false])(
  'tsgo sourcemap with tsconfig declarationMap=%s',
  async (declarationMap) => {
    const dir = path.join(tempDir, `source-map-tsgo-${declarationMap}`)
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    await build({
      input,
      plugins: [
        dts({
          generator: 'tsgo',
          tsgo: { moduleUrl: tsgoModuleUrl },
          tsconfig: declarationMap
            ? tsconfig
            : path.resolve(
                import.meta.dirname,
                'fixtures/source-map/tsconfig-no-declaration-map.json',
              ),
          sourcemap: true,
          dtsOnly: true,
          logger,
        }),
      ],
      output: { dir },
      write: true,
    })

    const warning =
      "The `tsgo` generator requires `compilerOptions.declarationMap: true` in your tsconfig file for source mappings. The plugin's `sourcemap` option does not override the tsconfig."
    if (declarationMap) {
      expect(logger.warn).not.toHaveBeenCalledWith(warning)
      const sourcemap = await readFile(
        path.resolve(dir, 'index.d.ts.map'),
        'utf8',
      )
      validateSourceMap(sourcemap)
    } else {
      expect(logger.warn).toHaveBeenCalledWith(warning)
    }
  },
)

// https://github.com/rolldown/tsdown/issues/426
describe('default export binding', () => {
  const root = path.resolve(
    import.meta.dirname,
    'fixtures/source-map-default-export',
  )
  const generators = {
    tsc: { generator: 'tsc', tsc: { newContext: true } },
    tsgo: { generator: 'tsgo', tsgo: { moduleUrl: tsgoModuleUrl } },
    oxc: { generator: 'oxc' },
  } as const

  test.each([
    // no mapping of its own, falls back to the `export default` statement
    ['expression', 'tsc', [3, 0]],
    ['expression', 'tsgo', [3, 0]],
    ['member-expression', 'tsc', [3, 0]],
    ['member-expression', 'tsgo', [3, 0]],
    ['non-ascii', 'tsc', [3, 0]],
    ['non-ascii', 'tsgo', [3, 0]],
    ['export-assignment', 'tsc', [3, 0]],
    ['export-assignment', 'tsgo', [3, 0]],
    ['object', 'tsc', [3, 0]],
    ['object', 'tsgo', [3, 0]],
    // oxc maps the declaration itself
    ['object', 'oxc', [3, 0]],
    // the line has mappings already, the binding is left alone
    ['typed', 'tsc', [6, 20]],
    ['typed', 'tsgo', [6, 20]],
    ['typed', 'oxc', [6, 0]],
    // user declarations keep their position
    ['user-binding', 'tsc', [1, 6]],
    ['user-binding', 'tsgo', [1, 6]],
    ['user-binding', 'oxc', [1, 6]],
    ['user-class', 'tsc', [1, 6]],
    ['user-class', 'tsgo', [1, 6]],
    ['user-class', 'oxc', [1, 6]],
    ['user-overload', 'tsc', [1, 9]],
    ['user-overload', 'tsgo', [1, 9]],
    ['user-overload', 'oxc', [1, 9]],
    ['user-non-ascii', 'tsc', [2, 6]],
    ['user-non-ascii', 'tsgo', [2, 6]],
    ['user-non-ascii', 'oxc', [2, 6]],
  ] as const)('%s (%s)', async (fixture, generator, [line, column]) => {
    const dir = path.join(tempDir, `default-export-${fixture}-${generator}`)
    await build({
      input: path.resolve(root, `${fixture}.ts`),
      plugins: [
        dts({
          ...generators[generator],
          tsconfig: path.resolve(root, 'tsconfig.json'),
          sourcemap: true,
          dtsOnly: true,
        }),
      ],
      output: { dir },
      write: true,
      logLevel: 'silent',
    })

    const fileName = path.resolve(dir, `${fixture}.d.ts`)
    const lines = (await readFile(fileName, 'utf8')).split('\n')
    const generatedLine = lines.findIndex((code) => code.includes('_default'))
    const generatedColumn = lines[generatedLine].indexOf('_default')

    const consumer = new SourceMapConsumer(
      JSON.parse(await readFile(`${fileName}.map`, 'utf8')),
    )
    const mappings: any[] = []
    consumer.eachMapping((mapping) => {
      mappings.push(mapping)
    })
    expect(
      mappings.find(
        (mapping) =>
          mapping.generatedLine === generatedLine + 1 &&
          mapping.generatedColumn === generatedColumn,
      ),
    ).toMatchObject({ originalLine: line, originalColumn: column })
  })
})

// https://github.com/rolldown/tsdown/issues/975
test('empty dts chunk does not break output sourcemap', async () => {
  const warnings: string[] = []
  await rolldownBuild(
    path.resolve(import.meta.dirname, 'fixtures/empty-chunk/index.ts'),
    [dts()],
    {
      onLog: (level, log) => {
        if (level === 'warn') {
          warnings.push(log.code!)
        }
      },
    },
    { sourcemap: true, preserveModules: true },
  )
  expect(warnings).not.toContain('SOURCEMAP_BROKEN')
  expect(warnings).toHaveLength(0)
})

test('disable dts source map only', async () => {
  const { chunks } = await rolldownBuild(
    input,
    [dts({ sourcemap: false })],
    {},
    { sourcemap: true },
  )
  expect(chunks.map((chunk) => chunk.fileName).toSorted()).toEqual([
    'index.d.ts',
    'index.js',
    'index.js.map',
    expect.stringContaining('rolldown-runtime-'),
  ])
})

// https://github.com/rolldown/tsdown/issues/1091
test.each([true, 'inline'] as const)(
  'disable dts source map only does not leave sourceMappingURL (sourcemap: %s)',
  async (sourcemap) => {
    const { chunks } = await rolldownBuild(
      input,
      [dts({ sourcemap: false })],
      {},
      { sourcemap },
    )

    const dtsChunk = chunks.find((chunk) => chunk.fileName === 'index.d.ts')
    expect(dtsChunk?.type).toBe('chunk')
    if (dtsChunk?.type !== 'chunk') return
    expect(dtsChunk.code).not.toContain('sourceMappingURL')
    expect(dtsChunk.map).toBeNull()

    const jsChunk = chunks.find((chunk) => chunk.fileName === 'index.js')
    if (jsChunk?.type !== 'chunk') throw new Error('missing index.js')
    expect(jsChunk.code).toContain('//# sourceMappingURL=')
  },
)
