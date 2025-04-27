import type { Plugin } from 'rolldown'

export function createDtsInputPlugin(): Plugin {
  return {
    name: 'rolldown-plugin-dts:dts-input',

    options(options) {
      return {
        treeshake:
          options.treeshake !== false
            ? {
                ...(options.treeshake === true ? {} : options.treeshake),
                moduleSideEffects: false,
              }
            : false,
        ...options,
      }
    },

    outputOptions(options) {
      return {
        ...options,
        entryFileNames(chunk) {
          if (chunk.name.endsWith('.d')) {
            return '[name].ts'
          }
          return '[name].d.ts'
        },
      }
    },
  }
}
