import path from 'node:path'
import Debug from 'obug'
import type ts from 'typescript'

const debug = Debug('rolldown-plugin-dts:tsc-context')

// A parsed tsconfig file with its path.
export interface ParsedProject {
  tsconfigPath: string
  parsedConfig: ts.ParsedCommandLine
}

// A map of a source file to the project it belongs to. This makes it faster to
// find the project for a source file.
export type SourceFileToProjectMap = Map<string, ParsedProject>

export interface TscContext {
  programs: ts.Program[]
  files: Map<string, string>

  // A map of a root tsconfig to all projects referenced from it.
  projects: Map<string, SourceFileToProjectMap>
}

export function createContext(): TscContext {
  const programs: ts.Program[] = []
  const files = new Map<string, string>()
  const projects = new Map<string, SourceFileToProjectMap>()
  return { programs, files, projects }
}

export function invalidateContextFile(context: TscContext, file: string): void {
  file = path.resolve(file).replaceAll('\\', '/')
  debug(`invalidating context file: ${file}`)
  context.files.delete(file)
  context.programs = context.programs.filter((program) => {
    return !program
      .getSourceFiles()
      .some((sourceFile) => sourceFile.fileName === file)
  })
  context.projects.clear()
}

export const globalContext: TscContext = createContext()
