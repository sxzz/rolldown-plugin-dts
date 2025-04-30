import path from 'node:path'

export const RE_JS: RegExp = /\.([cm]?)jsx?$/
export const RE_TS: RegExp = /\.([cm]?)tsx?$/
export const RE_DTS: RegExp = /\.d\.([cm]?)ts$/
export const RE_DTS_MAP: RegExp = /\.d\.([cm]?)ts\.map$/
export const RE_NODE_MODULES: RegExp = /[\\/]node_modules[\\/]/
export const RE_CSS: RegExp = /\.css$/

export function filename_js_to_dts(id: string): string {
  return id.replace(RE_JS, '.d.$1ts')
}
export function filename_ts_to_dts(id: string): string {
  return id.replace(RE_TS, '.d.$1ts')
}
export function filename_dts_to(id: string, ext: 'js' | 'ts'): string {
  return id.replace(RE_DTS, `.$1${ext}`)
}

export function isRelative(id: string): boolean {
  return path.isAbsolute(id) || id[0] === '.'
}
