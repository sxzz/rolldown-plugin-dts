// index.d.ts

//#region tests/fixtures/import-referenced-interface/bar.d.ts
interface Bar {}

//#endregion
//#region tests/fixtures/import-referenced-interface/index.d.ts
interface Foo {
  bar: Bar;
}

//#endregion
export { Foo };