// index.d.ts

//#region tests/rollup-plugin-dts/export-star/b.d.ts
interface B {}

//#endregion
//#region tests/rollup-plugin-dts/export-star/index.d.ts
declare class A {}

//#endregion
export { A, B };