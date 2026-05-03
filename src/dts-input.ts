import { RE_DTS, replaceTemplateName, resolveTemplateFn } from './filename.ts'
import type { OptionsResolved } from './options.ts'
import type { Plugin } from 'rolldown'

/**
 * Creates the Rolldown {@linkcode Plugin | plugin} used when
 * {@linkcode OptionsResolved.dtsInput | dtsInput} is `true`. Skips `.d.ts`
 * generation and instead treats the input files as pre-existing declaration
 * files to be bundled directly.
 *
 * @param resolvedOptions - Plugin options, used here to set `moduleSideEffects` in the output when {@linkcode OptionsResolved.sideEffects | sideEffects} is `false`.
 * @returns A Rolldown plugin that configures the output to bundle `.d.ts` files directly from the input.
 */
export function createDtsInputPlugin(
  resolvedOptions: Pick<OptionsResolved, 'sideEffects'>,
): Plugin {
  const { sideEffects } = resolvedOptions

  return {
    name: 'rolldown-plugin-dts:dts-input',

    options:
      sideEffects === false
        ? (options) => {
            return {
              treeshake:
                options.treeshake === false
                  ? false
                  : {
                      ...(options.treeshake === true ? {} : options.treeshake),
                      moduleSideEffects: false,
                    },
              ...options,
            }
          }
        : undefined,

    outputOptions(options) {
      return {
        ...options,
        entryFileNames(chunk) {
          const { entryFileNames } = options
          if (entryFileNames) {
            const nameTemplate = resolveTemplateFn(entryFileNames, chunk)

            const renderedName = replaceTemplateName(nameTemplate, chunk.name)
            if (RE_DTS.test(renderedName)) {
              return nameTemplate
            }

            const renderedNameWithD = replaceTemplateName(
              nameTemplate,
              `${chunk.name}.d`,
            )
            if (RE_DTS.test(renderedNameWithD)) {
              return renderedNameWithD
            }

            // Ignore the user-defined entryFileNames if it doesn't match the dts pattern
          }

          if (RE_DTS.test(chunk.name)) {
            return chunk.name
          }

          if (chunk.name.endsWith('.d')) {
            return '[name].ts'
          }
          return '[name].d.ts'
        },
      }
    },
  }
}
