// index.d.ts

//#region tests/fixtures/inline-import/bar.d.ts
interface Bar {}
declare const Baz = 123;

//#endregion
//#region tests/fixtures/inline-import/index.d.ts
interface Foo {
  bar: import("./bar").Bar;
  baz: typeof import("./bar").Baz;
}

//#endregion
export { Foo };