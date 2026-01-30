import path from 'node:path'
import { createResolver } from 'dts-resolver'
import { createDebug } from 'obug'
import { ResolverFactory } from 'rolldown/experimental'
import { importerId, include } from 'rolldown/filter'
import {
  filename_to_dts,
  RE_CSS,
  RE_DTS,
  RE_JSON,
  RE_TS,
  RE_VUE,
} from './filename.ts'
import type { OptionsResolved } from './options.ts'
import type { Plugin, ResolvedId } from 'rolldown'

const debug = createDebug('rolldown-plugin-dts:resolver')

function isSourceFile(id: string) {
  return RE_TS.test(id) || RE_VUE.test(id) || RE_JSON.test(id)
}

export function createDtsResolvePlugin({
  cwd,
  tsconfig,
  tsconfigRaw,
  resolver,
  sideEffects,
}: Pick<
  OptionsResolved,
  'cwd' | 'tsconfig' | 'tsconfigRaw' | 'resolver' | 'sideEffects'
>): Plugin {
  const baseDtsResolver = createResolver({
    tsconfig,
    resolveNodeModules: true,
    ResolverFactory,
  })
  const moduleSideEffects = sideEffects ? true : null

  return {
    name: 'rolldown-plugin-dts:resolver',

    resolveId: {
      order: 'pre',
      // Guard: Only operate on imports inside .d.ts files
      filter: [include(importerId(RE_DTS))],
      async handler(id, importer, options) {
        if (!importer) return

        const external = {
          id,
          external: true,
          moduleSideEffects: sideEffects,
        }

        // Get Rolldown's resolution first for fallback and policy checks
        const rolldownResolution = await this.resolve(id, importer, options)
        debug(
          'Rolldown resolution for dts import %O from %O: %O',
          id,
          importer,
          rolldownResolution,
        )
        if (rolldownResolution?.external) {
          debug('Rolldown marked dts import as external:', id)
          return external
        }

        const dtsResolution = await resolveDtsPath(
          id,
          importer,
          rolldownResolution,
        )
        debug(
          'Dts resolution for dts import %O from %O: %O',
          id,
          importer,
          dtsResolution,
        )

        // If resolution failed, error or externalize
        if (!dtsResolution) {
          if (RE_CSS.test(id)) {
            debug('Externalizing css import:', id)
            return external
          }

          debug('Unresolvable dts import:', id, 'from', importer)

          const isFileImport = isFilePath(id)
          // Auto-export unresolvable packages
          return isFileImport ? null : external
        }

        // The path is either a declaration file or a source file that needs redirection.
        if (RE_DTS.test(dtsResolution)) {
          debug('Resolving dts import to declaration file:', id)
          // It's already a .d.ts file, we're done
          return {
            id: dtsResolution,
            moduleSideEffects,
          }
        }

        if (isSourceFile(dtsResolution)) {
          debug('Resolving dts import to source file:', id)
          // It's a .ts/.vue source file, so we load it to ensure its .d.ts is generated,
          // then redirect the import to the future .d.ts path
          await this.load({ id: dtsResolution })
          return {
            id: filename_to_dts(dtsResolution),
            moduleSideEffects,
          }
        }
      },
    },
  }

  async function resolveDtsPath(
    id: string,
    importer: string,
    rolldownResolution: ResolvedId | null,
  ): Promise<string | null> {
    let dtsPath: string | undefined | null
    if (resolver === 'tsc') {
      const { tscResolve } = await import('./tsc/resolver.ts')
      dtsPath = tscResolve(
        id,
        importer,
        cwd,
        tsconfig,
        tsconfigRaw,
        // TODO reference
      )
    } else {
      dtsPath = baseDtsResolver(id, importer)
    }
    debug('Using %s for dts import: %O -> %O', resolver, id, dtsPath)

    if (dtsPath) {
      dtsPath = path.normalize(dtsPath)
    }

    if (!dtsPath || !isSourceFile(dtsPath)) {
      if (
        rolldownResolution &&
        isFilePath(rolldownResolution.id) &&
        isSourceFile(rolldownResolution.id) &&
        !rolldownResolution.external
      ) {
        return rolldownResolution.id
      }
      return null
    }

    return dtsPath
  }
}

function isFilePath(id: string) {
  return id.startsWith('.') || path.isAbsolute(id)
}
