// index.d.ts

//#region tests/fixtures/issue-254/foo.d.ts
enum E {}
interface Foo {
  e: E;
}
namespace Bar {
  export enum F {}
}

//#endregion
export { Bar, Foo };