import type { FileExtensionInfo } from 'typescript'

export interface VolarPlugin {
  extensions: {
    pattern: RegExp
    tsFileExtensionInfo: FileExtensionInfo
  }[]
  getCreateProgram: (
    ts: typeof import('typescript'),
  ) => typeof import('typescript').createProgram
  toTsFilename?: (id: string) => string
}

export class VolarContext {
  plugin: VolarPlugin
  patterns: RegExp[]

  constructor(plugin: VolarPlugin) {
    this.plugin = plugin
    this.patterns = plugin.extensions.map((ext) => ext.pattern)
  }

  isVolarFile(id: string): boolean {
    return this.patterns.some((pattern) => pattern.test(id))
  }

  getExtraFileExtensions(): FileExtensionInfo[] {
    return this.plugin.extensions.map((ext) => ext.tsFileExtensionInfo)
  }
}
