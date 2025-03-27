// index.d.ts

//#region tests/fixtures/enum/index.d.ts
declare enum Foo {
  A = 0,
  B = 1,
}
declare const enum Bar {
  A = 0,
  B = 1,
}

//#endregion
export { Bar, Foo };