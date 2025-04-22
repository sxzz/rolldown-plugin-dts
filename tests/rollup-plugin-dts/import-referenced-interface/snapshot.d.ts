// index.d.ts
//#region tests/rollup-plugin-dts/import-referenced-interface/bar.d.ts
interface Bar {}

//#endregion
//#region tests/rollup-plugin-dts/import-referenced-interface/index.d.ts
interface Foo {
  bar: Bar;
}

//#endregion
export { Foo };