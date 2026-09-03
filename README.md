# rolldown-plugin-dts

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![Unit Test][unit-test-src]][unit-test-href]

A Rolldown plugin that generates and bundles TypeScript declaration files.

## Install

Requires Rolldown 1.2.0 or later and Node.js
`^22.18.0 || ^24.11.0 || >=26.0.0`.

```bash
npm i -D rolldown-plugin-dts
```

Install the compiler required by your generator:

```bash
npm i -D typescript@^6    # tsc
npm i -D typescript@next  # tsgo API
```

Oxc is provided by Rolldown and needs no additional dependency.

## Usage

```ts
// rolldown.config.ts
import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

export default defineConfig({
  input: 'src/index.ts',
  plugins: [dts()],
  output: {
    dir: 'dist',
    format: 'es',
  },
})
```

See [rolldown.config.ts](./rolldown.config.ts) for the project's own setup.

## Generators

| Generator | Use it for                                        | Requirement                                 |
| --------- | ------------------------------------------------- | ------------------------------------------- |
| `tsc`     | Full TypeScript compatibility                     | TypeScript 5.x or 6.x                       |
| `oxc`     | Fast generation for isolated declarations         | Code compatible with `isolatedDeclarations` |
| `tsgo`    | TypeScript Go's asynchronous declaration emit API | TypeScript 7.1 or later                     |

When `generator` is omitted, the plugin selects:

1. `oxc` when `compilerOptions.isolatedDeclarations` is enabled.
2. `tsgo` when `typescript` exposes `Program.prototype.getDeclarationEmit`.
3. `tsc` otherwise.

Automatic selection only inspects `typescript`. When `tsgo` is selected
explicitly, a module without `getDeclarationEmit` reports an error.

`generator` also accepts an object implementing the exported `Generator`
interface.

```ts
dts({
  generator: 'oxc',
})
```

## Options

### General

| Option            | Description                                                                               | Default                 |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| `generator`       | Built-in generator name or a custom `Generator` implementation.                           | Inferred                |
| `tsc`             | Options for the built-in `tsc` generator.                                                 | `{}`                    |
| `entry`           | Glob or globs selecting files to emit. Supports `!` negation and paths relative to `cwd`. | Rolldown entries        |
| `cwd`             | Base directory for config discovery, globs, and relative paths.                           | `process.cwd()`         |
| `dtsInput`        | Treat entry files as existing declarations.                                               | `false`                 |
| `emitDtsOnly`     | Remove non-declaration chunks from the output.                                            | `false`                 |
| `tsconfig`        | Config path; `true` discovers one and `false` disables loading.                           | Nearest `tsconfig.json` |
| `tsconfigRaw`     | Raw config values merged over the loaded config.                                          | `{}`                    |
| `compilerOptions` | Compiler options merged over the loaded config.                                           | `{}`                    |
| `sourcemap`       | Emit `.d.ts.map` files.                                                                   | `declarationMap`        |
| `resolver`        | Resolve declaration imports with `oxc` or `tsc`.                                          | `oxc`                   |
| `cjsDefault`      | Convert a single default export to `export =`.                                            | `false`                 |
| `sideEffects`     | Mark declaration modules as having side effects.                                          | `false`                 |
| `logger`          | Logger implementing `info`, `warn`, and `error`.                                          | `console`               |

`entry` may include files that are not Rolldown entry points:

```ts
dts({
  entry: ['src/**/*.ts', '!src/icons/**'],
})
```

`cjsDefault` only changes the emitted export syntax. It does not enable
CommonJS-style declaration input.

### TypeScript (`tsc`)

| Option            | Description                                                   | Default                                  |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------- |
| `tsc.build`       | Use TypeScript build mode and follow project references.      | `false`                                  |
| `tsc.incremental` | Persist build outputs, including `.tsbuildinfo`, to disk.     | Enabled by the matching tsconfig options |
| `vue`             | Register the built-in Vue integration using `vue-tsc`.        | `false`                                  |
| `tsc.parallel`    | Run `tsc` or `vue-tsc` in a separate process.                 | `false`                                  |
| `tsc.eager`       | Load every file listed by `tsconfig.json`.                    | `false`                                  |
| `tsc.newContext`  | Use an isolated compiler cache instead of the shared context. | `false`                                  |
| `emitJs`          | Generate declarations for JavaScript files with JSDoc types.  | `allowJs` or `checkJs`                   |

`tsc.incremental` applies to build mode. When disabled, build outputs stay in
memory.

To invalidate a file in the shared compiler cache:

```ts
import {
  globalContext,
  invalidateContextFile,
} from 'rolldown-plugin-dts/tsc-context'

invalidateContextFile(globalContext, 'src/foo.ts')
```

### Custom languages

`customLanguages` registers non-standard source files such as Vue or Astro.
Volar integrations must provide both `volarTypeScript` and
`createVolarPlugins`; they require the `tsc` generator. `vue: true` is the
preconfigured Vue shortcut.

This API is experimental and may change.

### Oxc

`oxc` accepts
[`IsolatedDeclarationsOptions`](https://oxc.rs/docs/guide/usage/transformer.html).
Use the top-level `sourcemap` option for declaration maps.

```ts
dts({
  generator: 'oxc',
  oxc: {
    stripInternal: true,
  },
})
```

### TypeScript Go

The TypeScript Go generator is experimental and requires a `tsconfig.json`.

`tsgo.moduleUrl` defaults to `import.meta.resolve('typescript')`. It can point
to an npm alias or another compatible TypeScript module. The selected module
must expose `Program.prototype.getDeclarationEmit`; there is no package-name
fallback.

`tsgo.vfs` defaults to `false` and only affects `tsgo`.

```ts
dts({
  generator: 'tsgo',
  tsgo: {
    moduleUrl: import.meta.resolve('typescript'),
    path: '/path/to/tsserver',
    vfs: true,
  },
})
```

For example, a separately installed npm alias can be selected with
`moduleUrl: import.meta.resolve('typescript-next')`.

With VFS enabled, `tsgo` receives the transformed code observed by the dts
transform hook instead of rereading source files from disk. Source-transforming
plugins must appear before `dts()` for their output to be included.

## Vite

Exclude generated declarations from Oxc transformation. Because `oxc.exclude`
replaces Vite's default exclusions, keep JavaScript files excluded as well:

```ts
// vite.config.ts
import { defineConfig } from 'vite'

export default defineConfig({
  oxc: {
    exclude: [/\.js$/, /\.d\.[cm]?ts$/],
  },
})
```

## Code splitting

Declaration chunk names must end in `.d`:

```ts
export default {
  codeSplitting: {
    groups: [
      { test: /foo.*\.d\.[cm]?ts$/, name: 'shared.d' },
      { test: /foo/, name: 'shared' },
    ],
  },
}
```

## CommonJS

Declaration bundling requires an ESM Rolldown output. For CommonJS packages,
build the JavaScript output separately and use `emitDtsOnly` for a second
declaration-only build.

The plugin expects ESM-style declaration input. Syntax such as `export =` or
`import x = require('x')` may not bundle correctly. If it comes from a
dependency, mark that dependency as external.

## Credits

Inspired by
[rollup-plugin-dts](https://github.com/Swatinem/rollup-plugin-dts), with an
independent implementation. Its MIT-licensed test suite is used with
permission.

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/sxzz/sponsors/sponsors.svg">
    <img src='https://cdn.jsdelivr.net/gh/sxzz/sponsors/sponsors.svg'/>
  </a>
</p>

## License

[MIT](./LICENSE) License © 2025-PRESENT [Kevin Deng](https://github.com/sxzz)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/rolldown-plugin-dts.svg
[npm-version-href]: https://npmjs.com/package/rolldown-plugin-dts
[npm-downloads-src]: https://img.shields.io/npm/dm/rolldown-plugin-dts
[npm-downloads-href]: https://www.npmcharts.com/compare/rolldown-plugin-dts?interval=30
[unit-test-src]: https://github.com/sxzz/rolldown-plugin-dts/actions/workflows/unit-test.yml/badge.svg
[unit-test-href]: https://github.com/sxzz/rolldown-plugin-dts/actions/workflows/unit-test.yml
