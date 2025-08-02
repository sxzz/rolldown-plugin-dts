import Debug from 'debug'
import type ts from 'typescript'

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
  context.files.delete(file)
  context.programs = context.programs.filter((program) => {
    return !program
      .getSourceFiles()
      .some((sourceFile) => sourceFile.fileName === file)
  })
}

export const globalContext: TscContext = createContext()
