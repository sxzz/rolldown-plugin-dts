// index.d.ts

//#region tests/rollup-plugin-dts/type-function/index.d.ts
interface A {}
interface B {}
interface C {}
declare type Foo = (a: A, b: B) => C;

//#endregion
export { Foo };