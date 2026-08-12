// index.d.ts
declare namespace bar_d_exports {
  export { Bar, IBar };
}
declare class Bar {}
interface IBar {}
//#endregion
//#region tests/rollup-plugin-dts/inline-import-namespace/index.d.ts
export interface Foo {
  ns: typeof bar_d_exports;
}
//#endregion