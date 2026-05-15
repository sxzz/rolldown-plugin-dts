// index.d.ts
//#region tests/rollup-plugin-dts/using-namespace-import/namespace.d.ts
interface Bar {}
//#endregion
//#region tests/rollup-plugin-dts/using-namespace-import/index.d.ts
interface Foo {
  bar: Bar;
}
//#endregion
export { Foo };