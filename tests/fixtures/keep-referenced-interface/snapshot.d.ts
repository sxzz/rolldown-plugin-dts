// index.d.ts

//#region tests/fixtures/keep-referenced-interface/index.d.ts
interface Bar {}
interface Foo {
  bar: Bar;
}

//#endregion
export { Foo };