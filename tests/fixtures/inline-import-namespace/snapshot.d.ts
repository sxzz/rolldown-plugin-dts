// index.d.ts

//#region tests/fixtures/inline-import-namespace/index.d.ts
interface Foo {
  ns: typeof import("./bar");
}

//#endregion
export { Foo };