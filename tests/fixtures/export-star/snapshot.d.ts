// index.d.ts

//#region tests/fixtures/export-star/b.d.ts
interface B {}

//#endregion
//#region tests/fixtures/export-star/index.d.ts
declare class A {}

//#endregion
export { A, B };