import {
  filename_js_to_dts,
  RE_DTS,
  RE_JS,
  replaceTemplateName,
  resolveTemplateFn,
} from './filename.ts'
import type { OptionsResolved } from './options.ts'
import type { Plugin } from 'rolldown'

/** Output and treeshake options for `dtsOnly` builds. */
export function createDtsOnlyPlugin({
  sideEffects,
}: Pick<OptionsResolved, 'sideEffects'>): Plugin {
  return {
    name: 'rolldown-plugin-dts:dts-only',

    options:
      sideEffects === false
        ? (options) => {
            return {
              treeshake:
                // eslint-disable-next-line unicorn/prefer-logical-operator-over-ternary
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

            // `[name].mjs` becomes `[name].d.mts`, as with regular builds.
            if (RE_JS.test(nameTemplate)) {
              const name = chunk.name.endsWith('.d')
                ? chunk.name.slice(0, -2)
                : chunk.name
              return filename_js_to_dts(replaceTemplateName(nameTemplate, name))
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
