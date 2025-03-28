// index.d.ts

//#region tests/fixtures/export-default-function/index.d.ts
declare function foo(): void;
type index_d_default = foo

//#endregion
export { index_d_default as default };