import {
  RUNTIME_MODULE_ID,
  type ChunkFileNamesFunction,
  type PreRenderedChunk,
} from 'rolldown'
import { exactRegex } from 'rolldown/filter'

/**
 * Matches JavaScript source file extensions: `.js`, `.mjs`, `.cjs`, `.jsx`.
 */
export const RE_JS: RegExp = /\.([cm]?)jsx?$/

/**
 * Matches TypeScript source file extensions: `.ts`, `.mts`, `.cts`, `.tsx`.
 */
export const RE_TS: RegExp = /\.([cm]?)tsx?$/

/**
 * Matches TypeScript declaration file extensions: `.d.ts`, `.d.mts`, `.d.cts`.
 */
export const RE_DTS: RegExp = /\.d\.([cm]?)ts$/

/**
 * Matches TypeScript declaration map files:
 * `.d.ts.map`, `.d.mts.map`, `.d.cts.map`.
 */
export const RE_DTS_MAP: RegExp = /\.d\.([cm]?)ts\.map$/

/**
 * Matches any path segment containing `node_modules`.
 */
export const RE_NODE_MODULES: RegExp = /[\\/]node_modules[\\/]/

/**
 * Matches CSS and common preprocessor extensions:
 * `.css`, `.scss`, `.sass`, `.less`, `.styl`, `.stylus`.
 */
export const RE_CSS: RegExp = /\.(?:css|scss|sass|less|styl|stylus)$/

/**
 * Matches Vue single-file component files: `.vue`.
 */
export const RE_VUE: RegExp = /\.vue$/

/**
 * Matches JSON files: `.json`.
 */
export const RE_JSON: RegExp = /\.json$/

/**
 * Matches Rolldown's internal
 * {@linkcode RUNTIME_MODULE_ID | runtime module ID}
 * exactly.
 */
export const RE_ROLLDOWN_RUNTIME: RegExp = exactRegex(RUNTIME_MODULE_ID)

/**
 * Converts a JavaScript file path to its `.d.ts` declaration counterpart.
 * e.g. `foo.mjs` → `foo.d.mts`
 *
 * @param id - The `.js` / `.mjs` / `.cjs` file path to convert.
 * @returns The corresponding `.d.ts` / `.d.mts` / `.d.cts` path.
 */
export function filename_js_to_dts(id: string): string {
  return id.replace(RE_JS, '.d.$1ts')
}

/**
 * Converts any source file path to its `.d.ts` declaration counterpart.
 * Handles `.ts`, `.js`, `.vue`, and `.json` inputs.
 * e.g. `foo.vue` → `foo.vue.d.ts`, `foo.ts` → `foo.d.ts`
 *
 * @param id - The source file path to convert.
 * @returns The corresponding `.d.ts` path.
 */
export function filename_to_dts(id: string): string {
  return id
    .replace(RE_VUE, '.vue.ts')
    .replace(RE_TS, '.d.$1ts')
    .replace(RE_JS, '.d.$1ts')
    .replace(RE_JSON, '.json.d.ts')
}

/**
 * Converts a `.d.ts` declaration file path back to a `.ts` or `.js` source
 * path. e.g. `foo.d.mts` → `foo.mts` (with `ext: 'ts'`) or `foo.mjs`
 * (with `ext: 'js'`).
 *
 * @param id - The `.d.ts` / `.d.mts` / `.d.cts` file path to convert.
 * @param ext - The target extension: `'ts'` or `'js'`.
 * @returns The corresponding source file path.
 */
export function filename_dts_to(id: string, ext: 'js' | 'ts'): string {
  return id.replace(RE_DTS, `.$1${ext}`)
}

/**
 * Resolves a {@linkcode ChunkFileNamesFunction} or a plain template string to
 * a concrete string for the given {@linkcode chunk}.
 *
 * @param fn - A template string (e.g. `'[name].js'`) or a {@linkcode ChunkFileNamesFunction | function} that accepts a chunk and returns a template string.
 * @param chunk - The pre-rendered chunk passed to {@linkcode fn} when it is a function.
 * @returns The resolved file name template string.
 */
export function resolveTemplateFn(
  fn: string | ChunkFileNamesFunction,
  chunk: PreRenderedChunk,
): string {
  return typeof fn === 'function' ? fn(chunk) : fn
}

/**
 * Replaces every `[name]` placeholder in {@linkcode template} with the given
 * {@linkcode name}.
 *
 * @param template - A Rolldown output file name template containing `[name]`.
 * @param name - The chunk name to substitute in place of `[name]`.
 * @returns The template string with all `[name]` tokens replaced.
 */
export function replaceTemplateName(template: string, name: string): string {
  return template.replaceAll('[name]', name)
}
