// index.d.ts

//#region tests/fixtures/inline-import/index.d.ts
interface Foo {
  bar: import('./mod').Foo
  baz: typeof import('./mod').Bar
}

//#endregion
export { Foo };