// index.d.ts

//#region tests/fixtures/inline-import-generic/index.d.ts
interface Foo {
  bar: import("./bar").Bar<number>;
}

//#endregion
export { Foo };