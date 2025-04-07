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

````ts
interface Options {
  /**
   * When entries are `.dts` files (instead of `.ts` files), this option should be set to `true`.
   *
   * If enabled, the plugin will skip generating a `.dts` file for the entry point.
   */
  dtsInput?: boolean

  isolatedDeclaration?: Omit<IsolatedDeclarationsOptions, 'sourcemap'>

  /**
   * dts file name alias `{ [filename]: path }`
   *
   * @example
   * ```ts
   * inputAlias: {
   *   'foo.d.ts': 'foo/index.d.ts',
   * }
   */
  inputAlias?: Record<string, string>

  /**
   * Determines whether the module imported by `.dts` files should be treated as external or not.
   */
  external?: (
    id: string,
    importer: string,
    extraOptions: ResolveIdExtraOptions,
  ) => boolean | void
}
````

## Caveats

- The plugin uses Oxc's `isolatedDeclarations` to generate `.dts` files,
  which means you need to set `isolatedDeclarations: true` in your `tsconfig.json` and ensure there are no errors.

- Namespaces are not supported yet.
  - `export * as ns from './ns'`
  - `import * as ns from './ns'` and then `export { ns }`
  - `type ns = import('./ns')`

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
