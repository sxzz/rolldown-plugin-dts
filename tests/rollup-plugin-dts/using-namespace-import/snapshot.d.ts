// index.d.ts
declare namespace namespace_d_exports {
  export { Bar };
}
interface Bar {}
//#endregion
//#region tests/rollup-plugin-dts/using-namespace-import/index.d.ts
export interface Foo {
  bar: Bar;
}
//#endregion