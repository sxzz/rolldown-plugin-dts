import { createFakeJsPlugin } from './fake-js'
import { createGeneratePlugin } from './generate'
import type { IsolatedDeclarationsOptions } from 'oxc-transform'
import type { Plugin } from 'rolldown'
import type { CompilerOptions } from 'typescript'

export interface Options {
  /**
   * When entries are `.d.ts` files (instead of `.ts` files), this option should be set to `true`.
   *
   * If enabled, the plugin will skip generating a `.d.ts` file for the entry point.
   */
  dtsInput?: boolean
  /**
   * When `true`, the plugin will only emit `.d.ts` files and remove all other chunks.
   *
   * This feature is particularly beneficial when you need to generate `d.ts` files for the CommonJS format as part of a separate build process.
   */
  emitDtsOnly?: boolean

  /**
   * The `compilerOptions` for the TypeScript compiler.
   *
   * @see https://www.typescriptlang.org/docs/handbook/compiler-options.html
   */
  compilerOptions?: CompilerOptions
  /**
   * When `true`, the plugin will generate `.d.ts` files using `oxc-transform`,
   * which is blazingly faster than `typescript` compiler.
   *
   * This option is enabled when `isolatedDeclaration` in `tsconfig.json` is set to `true`.
   */
  isolatedDeclaration?: boolean | Omit<IsolatedDeclarationsOptions, 'sourcemap'>
  /**
   * An object mapping names to TypeScript source file paths. { [entryName: string]: string }
   *
   * @example
   *
   * The following config will generate at least two entry chunks with the names
   * `a.d.ts` and `b/index.d.ts`
   *
   * ```ts
   * inputAlias: {
   *   'a': 'src/main-a.ts',
   *   'b/index': 'src/main-b.ts'
   * }
   * ```
   */
  inputAlias?: { [entryName: string]: string }

  /** Resolve external types used in dts files from `node_modules` */
  resolve?: boolean | (string | RegExp)[]
}

export function dts(options: Options = {}): Plugin[] {
  const plugins: Plugin[] = []
  if (!options.dtsInput) {
    plugins.push(createGeneratePlugin(options))
  }
  plugins.push(createFakeJsPlugin(options))
  return plugins
}

export { createFakeJsPlugin, createGeneratePlugin }
