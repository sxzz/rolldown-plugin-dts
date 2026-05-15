// index.d.ts
//#region tests/rollup-plugin-dts/inline-import/bar.d.ts
interface Bar {}
declare const Baz = 123;
//#endregion
//#region tests/rollup-plugin-dts/inline-import/index.d.ts
interface Foo {
  bar: Bar;
  baz: typeof Baz;
}
//#endregion
export { Foo };