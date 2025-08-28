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

export function invalidateContextFile(context: TscContext, file: string): void {
  debug(`invalidating context file: ${file}`)

  const canonicalize = (p: string): string => {
    let result = p
    try {
      // Resolve symlinks if any; native preserves casing on supported platforms
      result = realpathSync.native(p)
    } catch {}
    result = ts.sys.resolvePath(result)
    if (!ts.sys.useCaseSensitiveFileNames) result = result.toLowerCase()
    return result
  }

  const target = canonicalize(file)

  // Remove from in-memory FS using both as-provided and canonical keys
  context.files.delete(file)
  if (file !== target) context.files.delete(target)

  // Evict any program that contains the target source file (canonical compare)
  context.programs = context.programs.filter((program) => {
    return !program
      .getSourceFiles()
      .some((sourceFile) => canonicalize(sourceFile.fileName) === target)
  })
}

export const globalContext: TscContext = createContext()

export function resetContext(context: TscContext): void {
  debug('resetting tsc context')
  context.files.clear()
  context.programs = []
}
