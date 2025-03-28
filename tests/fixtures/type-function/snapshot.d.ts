// index.d.ts

//#region tests/fixtures/type-function/index.d.ts
interface A {}
interface B {}
interface C {}
declare type Foo = (a: A, b: B) => C;

//#endregion
export { Foo };