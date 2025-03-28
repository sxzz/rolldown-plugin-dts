// index.d.ts

//#region tests/fixtures/issue-24-export-const/index.d.ts
type C = 123
declare let L;
declare var V;

//#endregion
export { C, L, V };