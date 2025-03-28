// index.d.ts

//#region tests/fixtures/export-simple-alias/index.d.ts
interface Foo {}
declare type Bar = Foo;

//#endregion
export { Bar };