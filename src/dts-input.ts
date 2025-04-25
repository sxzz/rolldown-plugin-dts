import { isRelative, RE_NODE_MODULES } from './utils/filename'
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
        entryFileNames: '[name].ts',
      }
    },

    resolveId: {
      order: 'pre',
      handler(id, importer, options) {
        if (options.isEntry) return

        if (RE_NODE_MODULES.test(id) || !isRelative(id)) {
          return { id, external: true }
        }
      },
    },
  }
}
