# rolldown-plugin-dts [![npm](https://img.shields.io/npm/v/rolldown-plugin-dts.svg)](https://npmjs.com/package/rolldown-plugin-dts)

[![Unit Test](https://github.com/sxzz/rolldown-plugin-dts/actions/workflows/unit-test.yml/badge.svg)](https://github.com/sxzz/rolldown-plugin-dts/actions/workflows/unit-test.yml)

A Rolldown plugin to generate and bundle dts files.

## Install

Requires **`rolldown@1.0.0-beta.9`** or later.

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

You can find an example in [here](./rolldown.config.ts).

## Options

Configuration options for the plugin.

### `cwd?: string`

The directory in which the plugin will search for the `tsconfig.json` file.

### `dtsInput?: boolean`

Set to `true` if your entry files are `.d.ts` files instead of `.ts` files.

When enabled, the plugin will skip generating a `.d.ts` file for the entry point.

### `emitDtsOnly?: boolean`

If `true`, the plugin will emit only `.d.ts` files and remove all other output chunks.

This is especially useful when generating `.d.ts` files for the CommonJS format as part of a separate build step.

### `tsconfig?: string | boolean`

The path to the `tsconfig.json` file.

- If set to `false`, the plugin will ignore any `tsconfig.json` file.
- You can still specify `compilerOptions` directly in the options.

**Default:** `'tsconfig.json'`

### `tsconfigRaw?: Omit<TsConfigJson, 'compilerOptions'>`

Pass a raw `tsconfig.json` object directly to the plugin.

See: [TypeScript tsconfig documentation](https://www.typescriptlang.org/tsconfig)

### `incremental?: boolean`

Controls how project references and incremental builds are handled:

- If your `tsconfig.json` uses [`references`](https://www.typescriptlang.org/tsconfig/#references), the plugin will use [`tsc -b`](https://www.typescriptlang.org/docs/handbook/project-references.html#build-mode-for-typescript) to build the project and all referenced projects before emitting `.d.ts` files.
- If `incremental` is `true`, all built files (including [`.tsbuildinfo`](https://www.typescriptlang.org/tsconfig/#tsBuildInfoFile)) will be written to disk, similar to running `tsc -b` in your project.
- If `incremental` is `false`, built files are kept in memory, minimizing disk usage.

Enabling this option can speed up builds by caching previous results, which is helpful for large projects with multiple references.

**Default:** `true` if your `tsconfig` has [`incremental`](https://www.typescriptlang.org/tsconfig/#incremental) or [`tsBuildInfoFile`](https://www.typescriptlang.org/tsconfig/#tsBuildInfoFile) enabled.

> **Note:** This option is only used when [`isolatedDeclarations`](#isolateddeclarations-boolean--omitisolateddeclarationsoptions-sourcemap) is `false`.

### `compilerOptions?: TsConfigJson.CompilerOptions`

Override the `compilerOptions` specified in `tsconfig.json`.

See: [TypeScript compilerOptions documentation](https://www.typescriptlang.org/tsconfig/#compilerOptions)

### `isolatedDeclarations?: boolean | Omit<IsolatedDeclarationsOptions, 'sourcemap'>`

If `true`, the plugin will generate `.d.ts` files using [Oxc](https://oxc.rs/docs/guide/usage/transformer.html), which is significantly faster than the TypeScript compiler.

This option is automatically enabled when `isolatedDeclarations` in `compilerOptions` is set to `true`.

### `sourcemap?: boolean`

If `true`, the plugin will generate declaration maps (`.d.ts.map`) for `.d.ts` files.

### `resolve?: boolean | (string | RegExp)[]`

Resolve external types used in `.d.ts` files from `node_modules`.

- If `true`, all external types are resolved.
- If an array, only types matching the provided strings or regular expressions are resolved.

### `vue?: boolean`

If `true`, the plugin will generate `.d.ts` files using `vue-tsc`.

### `parallel?: boolean`

If `true`, the plugin will launch a separate process for `tsc` or `vue-tsc`, enabling parallel processing of multiple projects.

### `eager?: boolean`

If `true`, the plugin will prepare all files listed in `tsconfig.json` for `tsc` or `vue-tsc`.

This is especially useful when you have a single `tsconfig.json` for multiple projects in a monorepo.

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
