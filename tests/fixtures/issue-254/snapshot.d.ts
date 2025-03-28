// index.d.ts

//#region tests/fixtures/issue-254/foo.d.ts
declare enum E {}
interface Foo {
  e: E;
}
declare namespace Bar {
  export enum F {}
}

//#endregion
export { Bar, Foo };