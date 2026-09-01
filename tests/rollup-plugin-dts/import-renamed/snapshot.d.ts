// index.d.ts
//#region tests/rollup-plugin-dts/import-renamed/bar.d.ts
interface Bar {}
//#endregion
//#region tests/rollup-plugin-dts/import-renamed/index.d.ts
export interface Foo {
  bar: Bar;
}
//#endregion