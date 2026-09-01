import path from 'node:path'
import { createDebug } from 'obug'
import type { ParsedCommandLine, Program } from 'typescript'

const debug = createDebug('rolldown-plugin-dts:tsc-context')

// A parsed tsconfig file with its path.
export interface ParsedProject {
  tsconfigPath: string
  parsedConfig: ParsedCommandLine
}

// A map of a source file to the project it belongs to. This makes it faster to
// find the project for a source file.
export type SourceFileToProjectMap = Map<string, ParsedProject>

export interface TscContext {
  programs: Program[]
  files: Map<string, string>

  // A map of a root tsconfig to all projects referenced from it.
  projects: Map<string, SourceFileToProjectMap>
}

/** Creates an empty, isolated TypeScript compiler context. */
export function createContext(): TscContext {
  const programs: Program[] = []
  const files = new Map<string, string>()
  const projects = new Map<string, SourceFileToProjectMap>()
  return { programs, files, projects }
}

/**
 * Removes a file and any dependent compiler state from a context.
 *
 * @param context - Context to invalidate.
 * @param file - File path to remove. Relative paths resolve from the process
 * working directory.
 */
export function invalidateContextFile(context: TscContext, file: string): void {
  file = path.resolve(file).replaceAll('\\', '/')
  debug(`invalidating context file: ${file}`)
  context.files.delete(file)
  context.programs = context.programs.filter((program) => {
    return program
      .getSourceFiles()
      .every((sourceFile) => sourceFile.fileName !== file)
  })
  context.projects.clear()
}

/** Shared compiler context used when no explicit context is provided. */
export const globalContext: TscContext = createContext()
