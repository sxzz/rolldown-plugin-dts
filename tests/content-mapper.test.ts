import {
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { rolldownBuild } from '@sxzz/test-utils'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { dts } from '../src/index.ts'
import { findSourceMapChunk } from './utils.ts'

const fixture = path.resolve(import.meta.dirname, 'fixtures/content-mapper')
const root = await realpath(
  await mkdtemp(path.join(os.tmpdir(), 'dts-content-mapper-')),
)
beforeEach(async () => {
  await cp(fixture, root, { recursive: true })
  await mkdir(path.join(root, 'node_modules'))
  await symlink(
    path.join(root, 'mapper'),
    path.join(root, 'node_modules/test-content-mapper'),
    'dir',
  )
})
afterEach(() => rm(root, { recursive: true, force: true }))
const moduleUrl = import.meta.resolve('typescript-next')
const options = {
  generator: 'tsgo' as const,
  tsconfig: path.join(root, 'tsconfig.json'),
  emitDtsOnly: true,
  tsgo: { moduleUrl, runExternalCode: true },
}

test.each(['index.ts', 'Example.component'])(
  'content mapper: %s',
  async (entry) => {
    const { chunks } = await rolldownBuild(path.join(root, entry), [
      dts(options),
    ])
    const declarations = chunks.filter((chunk) => chunk.type === 'chunk')
    expect(declarations.length).toBeGreaterThan(0)
    expect(declarations.map((chunk) => chunk.code).join('\n')).toContain(
      'name: string',
    )
  },
)

test('content mappers require external code permission', () => {
  expect(() => dts({ ...options, tsgo: { moduleUrl } })).toThrow(
    'tsgo.runExternalCode',
  )
})

test('content mappers reject VFS', () => {
  expect(() =>
    dts({ ...options, tsgo: { ...options.tsgo, vfs: true } }),
  ).toThrow('tsgo.vfs')
})

test('reports a missing mapper package', async () => {
  await writeFile(
    path.join(root, 'base.json'),
    JSON.stringify({
      contentMappers: [
        { package: 'nonexistent-content-mapper', extensions: ['.component'] },
      ],
    }),
  )
  await expect(
    rolldownBuild(path.join(root, 'index.ts'), [dts(options)]),
  ).rejects.toThrow('could not be resolved')
})

test('reports mapper failures', async () => {
  await writeFile(path.join(root, 'Example.component'), 'MAPPER_ERROR')
  await expect(
    rolldownBuild(path.join(root, 'Example.component'), [dts(options)]),
  ).rejects.toThrow('failed to transform this file')
})

test('reports mapper diagnostics even when their codes match TypeScript syntax errors', async () => {
  await writeFile(
    path.join(root, 'Example.component'),
    'export const value = 1 // MAPPER_DIAGNOSTIC',
  )
  await expect(
    rolldownBuild(path.join(root, 'Example.component'), [dts(options)]),
  ).rejects.toThrow('Test mapper diagnostic')
})

test.each(['broken.ts', 'Broken.component'])(
  'ignores unrelated syntax errors in %s',
  async (fileName) => {
    await writeFile(path.join(root, fileName), 'export const broken = ;')
    await writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        extends: './base.json',
        include: ['*.ts', '*.component'],
      }),
    )
    const { snapshot } = await rolldownBuild(
      path.join(root, 'Example.component'),
      [dts(options)],
    )
    expect(snapshot).toContain('name: string')
  },
)

test('declaration maps point to the original mapper source', async () => {
  const { chunks } = await rolldownBuild(
    path.join(root, 'Example.component'),
    [dts(options)],
    {},
    { dir: path.join(root, 'dist') },
  )
  const map = findSourceMapChunk(chunks, 'Example.component.d.ts.map')
  expect(map.sources).toEqual(['../Example.component'])
  expect(map.mappings).not.toBe('')
})

test('rebuilds mapped sources from disk', async () => {
  const plugins = [dts(options)]
  const entry = path.join(root, 'Example.component')
  const first = await rolldownBuild(entry, plugins)
  expect(first.snapshot).toContain('name: string')
  await writeFile(
    entry,
    'export default function greet(count: number): number { return count }',
  )
  const rebuilt = await rolldownBuild(entry, plugins)
  expect(rebuilt.snapshot).toContain('count: number')
  expect(rebuilt.snapshot).not.toContain('name: string')
})
