// index.d.ts

//#region tests/fixtures/inline-import-generic/bar.d.ts
interface Bar<T> {
  t: T;
}

//#endregion
//#region tests/fixtures/inline-import-generic/index.d.ts
interface Foo {
  bar: Bar<number>;
}

//#endregion
export { Foo };