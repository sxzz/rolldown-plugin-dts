import path from 'node:path'
import { createDebug } from 'obug'
import type { TscOptions } from '../options.ts'
import type ts from 'typescript'

const debug = createDebug('rolldown-plugin-dts:tsc-context')

/**
 * A parsed `tsconfig` file with its path.
 */
export interface ParsedProject {
  /**
   * The path to the
   * {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json}
   * file that was parsed. This is used as a key in the
   * {@linkcode TscContext.projects | projects} map of the
   * {@linkcode TscContext}.
   */
  tsconfigPath: string

  /**
   * The parsed
   * {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json}
   * file. This is used to create a {@linkcode ts.Program | program} for the
   * project.
   */
  parsedConfig: ts.ParsedCommandLine
}

/**
 * A map of a source file to the {@linkcode ParsedProject | project} it belongs
 * to. This makes it faster to find the project for a source file.
 */
export type SourceFileToProjectMap = Map<string, ParsedProject>

/**
 * The context for the TypeScript compiler. This is used to store the programs
 * and files that have been processed by the plugin. This allows the plugin to
 * reuse programs and files across multiple calls to `tscEmit`, which can
 * improve performance when processing multiple files in the same project.
 */
export interface TscContext {
  /**
   * The list of {@linkcode ts.Program | program}s that have been created by
   * the plugin. Each {@linkcode ts.Program | program} corresponds to a
   * {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json}
   * file that has been processed. The plugin will try to reuse existing
   * programs when processing files, but if a file is not found in any existing
   * {@linkcode ts.Program | program}, a new {@linkcode ts.Program | program}
   * will be created for it.
   */
  programs: ts.Program[]

  /**
   * A map of file paths to their contents. This is used to store the contents
   * of files that have been processed by the plugin. The key is the file path,
   * and the value is the file contents.
   */
  files: Map<string, string>

  /**
   * A map of a root `tsconfig` to all projects referenced from it.
   */
  projects: Map<string, SourceFileToProjectMap>
}

/**
 * Creates a new, empty {@linkcode TscContext}. Use this when
 * {@linkcode TscOptions.newContext | newContext} is `true` to get a fresh
 * context for each build.
 *
 * @returns A new {@linkcode TscContext} with empty program, file, and project collections.
 */
export function createContext(): TscContext {
  const programs: ts.Program[] = []
  const files = new Map<string, string>()
  const projects = new Map<string, SourceFileToProjectMap>()
  return { programs, files, projects }
}

/**
 * Removes a single file from the given {@linkcode TscContext}, causing it to
 * be reprocessed on the next build. This is a lighter alternative to
 * {@linkcode TscOptions.newContext | newContext}, which
 * forces a full context reset on every build.
 *
 * @param context - The context to invalidate the file in.
 * @param file - The path to the file to invalidate.
 *
 * @example
 * <caption>Invalidating a single file in the context</caption>
 *
 * ```ts
 * import {
 *   globalContext,
 *   invalidateContextFile,
 * } from 'rolldown-plugin-dts/tsc';
 *
 * invalidateContextFile(globalContext, 'src/foo.ts');
 * ```
 */
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

/**
 * The shared, module-level {@linkcode TscContext} used by default across all
 * builds. Reused automatically unless
 * {@linkcode TscOptions.newContext | newContext} is `true`.
 */
export const globalContext: TscContext = createContext()
