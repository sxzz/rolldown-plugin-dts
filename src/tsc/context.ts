import { realpathSync } from 'node:fs'
import Debug from 'debug'
import ts from 'typescript'

const debug = Debug('rolldown-plugin-dts:tsc-context')

export interface TscContext {
  programs: ts.Program[]
  files: Map<string, string>
}

export function createContext(): TscContext {
  const programs: ts.Program[] = []
  const files = new Map<string, string>()
  return { programs, files }
}

/**
 * Canonicalize a file path for robust comparisons across platforms and repos.
 * - Resolves symlinks (realpathSync.native when available)
 * - Applies TypeScript's path normalization via sys.resolvePath
 * - Folds case on case-insensitive filesystems
 * - Prevents missed invalidations that cause stale .d.ts in large repos
 */
export function canonicalizePath(
  p: string,
  sys: typeof ts.sys = ts.sys,
  realpath: ((p: string) => string) | undefined = realpathSync.native,
): string {
  let result = p
  try {
    if (realpath) result = realpath(p)
  } catch {
    // ignore realpath errors (non-existent, permissions, etc.)
  }
  // normalize using TS sys (handles separators and cwd)
  result = sys.resolvePath(result)
  if (!sys.useCaseSensitiveFileNames) result = result.toLowerCase()
  return result
}

/**
 * Invalidate a specific file from the TypeScript context:
 * - Removes any in-memory file contents for that path
 * - Evicts cached Programs that include the canonicalized path
 */
export function invalidateContextFile(context: TscContext, file: string): void {
  debug(`invalidating context file: ${file}`)

  const target = canonicalizePath(file)

  // Remove from in-memory FS using both as-provided and canonical keys
  context.files.delete(file)
  if (file !== target) context.files.delete(target)

  // Evict any program that contains the target source file (canonical compare)
  context.programs = context.programs.filter((program) => {
    return !program
      .getSourceFiles()
      .some((sourceFile) => canonicalizePath(sourceFile.fileName) === target)
  })
}

export const globalContext: TscContext = createContext()

export function resetContext(context: TscContext): void {
  debug('resetting tsc context')
  context.files.clear()
  context.programs = []
}
