import path from 'node:path'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import {
  canonicalizePath,
  createContext,
  invalidateContextFile,
  type TscContext,
} from '../src/tsc/context.ts'

describe('canonicalizePath', () => {
  test('applies TS sys.resolvePath and folds case when FS is case-insensitive', () => {
    const mockSys: typeof ts.sys = {
      ...ts.sys,
      useCaseSensitiveFileNames: false,
      resolvePath: (p: string) => p.replaceAll('\\', '/'),
    }

    const input = String.raw`C:\Repo\Src\Types.ts`
    const result = canonicalizePath(input, mockSys, undefined)
    expect(result).toBe('c:/repo/src/types.ts')
  })
})

describe('invalidateContextFile', () => {
  test('evicts programs when given differently-cased or normalized paths', () => {
    const originalUseCase = ts.sys.useCaseSensitiveFileNames
    const originalResolvePath = ts.sys.resolvePath
    try {
      ;(ts.sys as any).useCaseSensitiveFileNames = false
      ;(ts.sys as any).resolvePath = (p: string) => p.replaceAll('\\', '/')

      // Mock program with a single source file using different casing
      const sourceUpper = '/Repo/SRC/Types.ts'
      const program = {
        getSourceFiles() {
          return [{ fileName: sourceUpper }]
        },
      } as unknown as ts.Program

      const ctx: TscContext = createContext()
      ctx.programs = [program]

      // Invalidate using different path casing and separators
      const inputLower = path.posix.normalize('/repo/src/types.ts')
      invalidateContextFile(ctx, inputLower)

      expect(ctx.programs.length).toBe(0)
    } finally {
      ;(ts.sys as any).useCaseSensitiveFileNames = originalUseCase
      ;(ts.sys as any).resolvePath = originalResolvePath
    }
  })
})
