// index.d.ts

//#region rolldown:runtime



//#endregion
//#region tests/rollup-plugin-dts/export-star-as/foo.d.ts

declare namespace foo_d_exports {
  export { A, }
}
interface A {}

//#endregion
export { foo_d_exports as foo };