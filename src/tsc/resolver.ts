import path from 'node:path'
import { createDebug } from 'obug'
import { requireTS } from './load-tsc.ts'
import type { ResolvedProjectReference } from 'typescript'

const debug = createDebug('rolldown-plugin-dts:tsc-resolver')
const ts = requireTS()

export function tscResolve(
  id: string,
  importer: string,
  cwd: string,
  tsconfig: string | undefined,
  tsconfigRaw: any,
  reference?: ResolvedProjectReference,
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
