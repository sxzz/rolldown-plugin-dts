// index.d.ts

//#region tests/rollup-plugin-dts/type-constructor/index.d.ts
interface A {}
interface B {}
interface C {}
declare type Foo = new (a: A, b: B) => C;

//#endregion
export { Foo };