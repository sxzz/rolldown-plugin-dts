// index.d.ts
//#region tests/rollup-plugin-dts/issue-24-export-const/index.d.ts
declare const C = 123;
declare let L: number;
declare var V: number;

//#endregion
export { C, L, V };