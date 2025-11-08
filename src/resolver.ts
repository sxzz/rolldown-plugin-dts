import path from 'node:path'
import { createResolver } from 'dts-resolver'
import { ResolverFactory } from 'rolldown/experimental'
import {
  filename_to_dts,
  RE_CSS,
  RE_DTS,
  RE_JSON,
  RE_NODE_MODULES,
  RE_TS,
  RE_VUE,
} from './filename.ts'
import type { OptionsResolved } from './options.ts'
import type { Plugin, ResolvedId } from 'rolldown'

function isSourceFile(id: string) {
  return RE_TS.test(id) || RE_VUE.test(id) || RE_JSON.test(id)
}

export function createDtsResolvePlugin({
  cwd,
  tsconfig,
  tsconfigRaw,
  resolve,
  resolver,
  sideEffects,
}: Pick<
  OptionsResolved,
  'cwd' | 'tsconfig' | 'tsconfigRaw' | 'resolve' | 'resolver' | 'sideEffects'
>): Plugin {
  const baseDtsResolver = createResolver({
    tsconfig,
    resolveNodeModules: !!resolve,
    ResolverFactory,
  })
  const moduleSideEffects = sideEffects ? true : null

  return {
    name: 'rolldown-plugin-dts:resolver',

    resolveId: {
      order: 'pre',
      async handler(id, importer, options) {
        // Guard: Only operate on imports inside .d.ts files
        if (!importer || !RE_DTS.test(importer)) {
          return
        }

        const external = {
          id,
          external: true,
          moduleSideEffects: sideEffects,
        }

        // Guard: Externalize non-code imports
        if (RE_CSS.test(id)) {
          return external
        }

        // Get Rolldown's resolution first for fallback and policy checks
        const rolldownResolution = await this.resolve(id, importer, options)
        const dtsResolution = await resolveDtsPath(
          id,
          importer,
          rolldownResolution,
        )

        // If resolution failed, error or externalize
        if (!dtsResolution) {
          const isFileImport = isFilePath(id)

          // Auto-export unresolvable packages
          return isFileImport ? null : external
        }

        // Externalize non-bundled node_modules dependencies
        if (
          // request resolved to inside node_modules
          RE_NODE_MODULES.test(dtsResolution) &&
          // User doesn't want to bundle this module
          !shouldBundleNodeModule(id) &&
          // The importer is not in node_modules, or if it is, the module is marked as external by Rolldown
          (!RE_NODE_MODULES.test(importer) || rolldownResolution?.external)
        ) {
          return external
        }

        // The path is either a declaration file or a source file that needs redirection.
        if (RE_DTS.test(dtsResolution)) {
          // It's already a .d.ts file, we're done
          return {
            id: dtsResolution,
            moduleSideEffects,
          }
        }

        if (isSourceFile(dtsResolution)) {
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

  function shouldBundleNodeModule(id: string) {
    if (typeof resolve === 'boolean') return resolve
    return resolve.some((pattern) =>
      typeof pattern === 'string' ? id === pattern : pattern.test(id),
    )
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
