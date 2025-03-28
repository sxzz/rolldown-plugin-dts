// index.d.ts

//#region tests/fixtures/import-renamed/bar.d.ts
interface Bar {}

//#endregion
//#region tests/fixtures/import-renamed/index.d.ts
interface Foo {
  bar: Bar;
}

//#endregion
export { Foo };