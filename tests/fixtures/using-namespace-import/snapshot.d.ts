// index.d.ts

//#region tests/fixtures/using-namespace-import/namespace.d.ts
interface Bar {}

//#endregion
//#region tests/fixtures/using-namespace-import/index.d.ts
interface Foo {
  bar: Bar;
}

//#endregion
export { Foo };