// index.d.ts

//#region tests/fixtures/type-conditional/index.d.ts
interface A {}
interface B {}
interface C {}
declare type Foo = A extends B ? C : never;

//#endregion
export { Foo };