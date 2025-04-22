// index.d.ts
//#region rolldown:runtime



//#endregion
//#region tests/rollup-plugin-dts/inline-import-namespace/bar.d.ts

declare namespace bar_d_exports {
  export { Bar, IBar, }
}
declare class Bar {}
interface IBar {}

//#endregion
//#region tests/rollup-plugin-dts/inline-import-namespace/index.d.ts
interface Foo {
  ns: typeof bar_d_exports;
}

//#endregion
export { Foo };