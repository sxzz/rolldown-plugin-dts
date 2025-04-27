# rolldown-plugin-dts [![npm](https://img.shields.io/npm/v/rolldown-plugin-dts.svg)](https://npmjs.com/package/rolldown-plugin-dts)

[![Unit Test](https://github.com/sxzz/rolldown-plugin-dts/actions/workflows/unit-test.yml/badge.svg)](https://github.com/sxzz/rolldown-plugin-dts/actions/workflows/unit-test.yml)

A Rolldown plugin to generate and bundle dts files.

## Install

```bash
npm i rolldown-plugin-dts
```

## Usage

Add the plugin to your `rolldown.config.js`:

```js
// rolldown.config.js
import { dts } from 'rolldown-plugin-dts'

export default {
  input: './src/index.ts',
  plugins: [dts()],
  output: [{ dir: 'dist', format: 'es' }],
}
```

You can find a real demo in [here](./rolldown.config.ts).

## Options

```ts
interface Options {
  /**
   * The directory where the the plugin will look for the `tsconfig.json` file.
   */
  cwd?: string

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
   * The path to the `tsconfig.json` file.
   *
   * When set to `false`, the plugin will ignore any `tsconfig.json` file.
   * However, `compilerOptions` can still be specified directly in the options.
   *
   * @default `tsconfig.json`
   */
  tsconfig?: string | boolean

  /**
   * The `compilerOptions` for the TypeScript compiler.
   *
   * @see https://www.typescriptlang.org/docs/handbook/compiler-options.html
   */
  compilerOptions?: TsConfigJson.CompilerOptions

  /**
   * When `true`, the plugin will generate `.d.ts` files using `oxc-transform`,
   * which is blazingly faster than `typescript` compiler.
   *
   * This option is enabled when `isolatedDeclarations` in `compilerOptions` is set to `true`.
   */
  isolatedDeclarations?:
    | boolean
    | Omit<IsolatedDeclarationsOptions, 'sourcemap'>

  /**
   * When `true`, the plugin will generate declaration maps for `.d.ts` files.
   */
  sourcemap?: boolean

  /** Resolve external types used in dts files from `node_modules` */
  resolve?: boolean | (string | RegExp)[]
}
```

## Differences from `rollup-plugin-dts`

### Isolated Declarations

The plugin leverages Oxc's `isolatedDeclarations` to generate `.d.ts` files when `isolatedDeclarations` is enabled,
offering significantly faster performance compared to the `typescript` compiler.

### Single Build for ESM

`rolldown-plugin-dts` generates separate chunks for `.d.ts` files, enabling both source code (`.js`)
and type definition files (`.d.ts`) to be produced in a single build process.

However, this functionality is limited to ESM output format. Consequently,
**two** distinct build processes are required for CommonJS source code (`.cjs`)
and its corresponding type definition files (`.d.cts`).
In such cases, the `emitDtsOnly` option can be particularly helpful.

## Credits

The project is inspired by [rollup-plugin-dts](https://github.com/Swatinem/rollup-plugin-dts)
but has been independently implemented.
We extend our gratitude to the original creators for their contributions.
Furthermore, the test suite is authorized by them and distributed under the MIT license.

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/sxzz/sponsors/sponsors.svg">
    <img src='https://cdn.jsdelivr.net/gh/sxzz/sponsors/sponsors.svg'/>
  </a>
</p>

## License

[MIT](./LICENSE) License © 2025 [三咲智子 Kevin Deng](https://github.com/sxzz)
