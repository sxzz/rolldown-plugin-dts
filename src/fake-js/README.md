# fake-js

Bundling `.d.ts` files means resolving imports, merging modules, deduplicating
declarations, renaming conflicting names and tree-shaking what nobody uses —
everything a JavaScript bundler already does, except that rolldown does not
understand type syntax.

So this plugin does not teach rolldown TypeScript. It rewrites every declaration
into a piece of JavaScript that has the _same_ binding and reference structure,
lets rolldown bundle that, and then puts the declarations back using the names
rolldown ended up with.

## The idea

Take a declaration file:

```ts
// dep.d.ts
interface Foo {
  x: number
}
export declare function fn(a: Foo): void
```

`transform` replaces every declaration with a variable that binds the same
names and references the same identifiers, and keeps the original AST in a
side table:

```js
var [Foo] = [0, () => [], ['']]
export var [fn] = [1, () => [Foo], ['', '']]
```

The declaration itself is gone, but everything rolldown needs is preserved:
`Foo` is still a binding, `fn` still references it, and `fn` is still exported.
rolldown now bundles, tree-shakes and renames this as ordinary JavaScript. If
another module in the bundle declares `Foo` as well, this one is renamed, and
the reference to it follows:

```js
var [Foo$1] = [0, () => [], ['']]
var [fn] = [1, () => [Foo$1], ['', '']]
export { fn }
```

`renderChunk` parses that chunk, looks up declaration `1` in the side table,
copies the new names onto the stored AST — `Foo` becomes `Foo$1` — and prints
the declaration again:

```ts
interface Foo$1 {
  x: number
}
export declare function fn(a: Foo$1): void
```

## The encoding

```js
var [binding, ...] = [declarationId, (typeParam, ...) => [dep, ...], ["child", ...], sideEffect()]
```

| Slot            | Purpose                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| array pattern   | The names the declaration binds. An array pattern because `declare const a = 1, b = 2` binds several names at once, `var` because merged declarations redeclare the same name.                                     |
| `declarationId` | Index into the plugin's `declarationMap`, which holds the original AST.                                                                                                                                            |
| deps function   | Every identifier the declaration references. Its parameters are the declaration's type parameters, so a type parameter shadows an outer binding exactly like it does in TypeScript, and gets renamed the same way. |
| children array  | One empty string literal per identifier inside the declaration, only used to carry source positions back for sourcemaps.                                                                                           |
| `sideEffect()`  | Optional. A call to an unresolved global, so that a declaration nothing references — `declare module '...'`, `declare global` — is not tree-shaken away.                                                           |

## Export shape

A declaration written as `export declare const x` is emitted as
`export declare const x` again, not as `declare const x` plus a trailing
`export { x }`. The `export` keyword is only re-attached when

- the declaration was exported inline in its own source file, so a re-exported
  import keeps its `export { x } from '...'` specifier;
- the chunk exports it as a value under its own name, so `export type { x }`
  and `export { x as y }` keep theirs;
- every declaration it merges with qualifies too, because TypeScript requires
  merged declarations (overloads, `function` + `namespace`) to be all exported
  or all local;
- it does not collide with the `export =` that `cjsDefault` emits.

## Limitations

**CommonJS output is not supported.** `format: 'cjs'` throws. A `.d.ts` has no
runtime, so there is nothing for a CommonJS wrapper to mean, and the exports of
a chunk cannot be expressed as property assignments. The one CommonJS-shaped
output available is the `cjsDefault` option, which turns a chunk that exports
nothing but a default into `export = x`.

**CommonJS declaration input is not supported either.** `export = X` and
`import X = require('...')` are ambient CommonJS constructs without an ES module
equivalent, so they cannot take part in bundling. `export = <identifier>` is
rewritten to `export { x as default }` so that the common case still bundles;
anything else is reported by a warning. A dependency in `node_modules` written
this way should be marked as external instead.

Smaller ones:

- `declare module './relative'` is kept as-is and warned about, since a relative
  module declaration means something different once the file has moved.
- Re-exporting through a namespace object (`export * as ns from '...'` consumed
  by another module) only supports type usage.

## Files

| File                 | Scope                                                                                                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`           | The plugin. `transform` turns a declaration file into fake JavaScript, `renderChunk` turns a bundled chunk back into declarations, and `declarationMap` connects the two. Also names the `.d.ts` chunks and drops the `.d.ts.map` files when sourcemaps are off. |
| `exports.ts`         | Everything about the shape of the exports: what each module exports, collected during `transform`, and the `ChunkExportPlan` of a chunk — which names are type only, which declarations get their `export` keyword back, whether `export =` may be emitted.      |
| `patch.ts`           | Statement rewrites. `rewriteImportExport` prepares imports and exports for bundling, `patchImportExport`, `patchTsNamespace` and `patchReExport` undo that and rolldown's `__exportAll` / `__reExport` helpers afterwards.                                       |
| `dependency.ts`      | Walks a declaration for what it references: type references, type parameters, and `import('...')` types, which are hoisted into real namespace imports so rolldown can resolve them.                                                                             |
| `runtime-binding.ts` | The encoding above: the builder and the type guards that recognise it again in a chunk.                                                                                                                                                                          |
| `utils.ts`           | Small shared AST and comment helpers.                                                                                                                                                                                                                            |
| `types.ts`           | The types shared across the files.                                                                                                                                                                                                                               |
