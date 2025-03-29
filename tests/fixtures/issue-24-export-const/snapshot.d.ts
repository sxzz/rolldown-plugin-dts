// index.d.ts

//#region tests/fixtures/issue-24-export-const/index.d.ts
declare const C = 123;
declare let L: number;
declare var V: number;

//#endregion
export { C, L, V };