import type { Plugin } from 'rolldown'

export function createStaticFilePlugin(): Plugin {
  return {
    name: 'rolldown-plugin-dts:static-file',
    // renderChunk(code, chunk) {
    //   this.emitFile({
    //     type: 'chunk',
    //     id: chunk.fileName,
    //     name: chunk.name,
    //   })
    // },
  }
}
