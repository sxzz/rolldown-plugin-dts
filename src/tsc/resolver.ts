import path from 'node:path'
import { createDebug } from 'obug'
import ts from 'typescript'

const debug = createDebug('rolldown-plugin-dts:tsc-resolver')

/**
 * Resolves a module specifier to an absolute file path using TypeScript's
 * bundler module resolution strategy, respecting the provided `tsconfig`
 * compiler options.
 *
 * @param id - The module specifier to resolve (e.g. `'./foo'` or `'some-pkg'`).
 * @param importer - The absolute path of the file containing the import.
 * @param cwd - The working directory, used as the base when no `tsconfig` path is given.
 * @param tsconfig - Optional path to a {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json} to derive compiler options from.
 * @param tsconfigRaw - The raw {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json} object used to parse compiler options.
 * @param [reference] - Optional resolved project reference for cross-project resolution.
 * @returns The resolved absolute file path, or `undefined` if resolution failed.
 */
export function tscResolve(
  id: string,
  importer: string,
  cwd: string,
  tsconfig: string | undefined,
  tsconfigRaw: any,
  reference?: ts.ResolvedProjectReference,
): string | undefined {
  const baseDir = tsconfig ? path.dirname(tsconfig) : cwd
  const parsedConfig = ts.parseJsonConfigFileContent(
    tsconfigRaw,
    ts.sys,
    baseDir,
  )
  const resolved = ts.bundlerModuleNameResolver(
    id,
    importer,
    {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      ...parsedConfig.options,
    },
    ts.sys,
    undefined,
    reference,
  )
  debug(
    `tsc resolving id "%s" from "%s" -> %O`,
    id,
    importer,
    resolved.resolvedModule,
  )
  return resolved.resolvedModule?.resolvedFileName
}
