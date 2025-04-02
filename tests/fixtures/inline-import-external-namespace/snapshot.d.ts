// index.d.ts

//#region tests/fixtures/inline-import-external-namespace/index.d.ts
interface Foo {
  ns1: import("foo");
  ns2: typeof import("foo");
}

//#endregion
export { Foo };