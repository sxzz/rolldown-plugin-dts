import path from 'node:path'
import { rolldownBuild } from '@sxzz/test-utils'
import { describe, expect, test } from 'vitest'
import { dts, type Options } from '../../src/index.ts'
import { fixture } from '../utils.ts'

export const root: string = fixture('typecheck')
export const entry: string = path.join(root, 'index.ts')
export const tsconfig: string = path.join(root, 'tsconfig.json')

export const config = (name: string): string => path.join(root, `${name}.json`)
export const tsgo: { moduleUrl: string } = {
  moduleUrl: import.meta.resolve('typescript-next'),
}
export const tsrs: { moduleUrl: string } = {
  moduleUrl: import.meta.resolve('tsrs'),
}

const RE_TYPE_ERROR = /error\.ts.*TS2322/s

/**
 * Defines the type-checking tests every generator has to pass. Each case
 * builds its options from a config name, so the `noCheck` variant of the
 * config can be tested too.
 */
export function describeTypecheck(
  name: string,
  options: (name: string) => Options,
): void {
  describe(name, () => {
    test('ignores type errors by default', async () => {
      const { snapshot } = await rolldownBuild(entry, [
        dts({ ...options('tsconfig'), dtsOnly: true }),
      ])
      expect(snapshot).toContain('declare const value: number')
    })

    test('fails on type errors with `typecheck`', async () => {
      await expect(
        rolldownBuild(entry, [
          dts({ ...options('tsconfig'), dtsOnly: true, typecheck: true }),
        ]),
      ).rejects.toThrow(RE_TYPE_ERROR)
    })

    // tsc overrides `noCheck` in memory; the native API reads the config as is.
    const native = name.startsWith('tsgo') || name.startsWith('tsrs')
    test(`${native ? 'rejects' : 'overrides'} a tsconfig \`noCheck\` with \`typecheck\``, async () => {
      await expect(
        rolldownBuild(entry, [
          dts({
            ...options('tsconfig.nocheck'),
            dtsOnly: true,
            typecheck: true,
          }),
        ]),
      ).rejects.toThrow(
        native
          ? 'The `typecheck` option conflicts with `noCheck`'
          : RE_TYPE_ERROR,
      )
    })
  })
}
