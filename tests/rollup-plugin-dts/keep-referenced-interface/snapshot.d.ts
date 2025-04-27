// index.d.ts
//#region tests/rollup-plugin-dts/keep-referenced-interface/index.d.ts
interface Bar {}
interface Foo {
  bar: Bar;
}
//#endregion
export { Foo };