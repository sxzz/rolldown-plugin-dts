// index.d.ts
//#region tests/rollup-plugin-dts/type-conditional/index.d.ts
interface A {}
interface B {}
interface C {}
declare type Foo = A extends B ? C : never;
//#endregion
export { Foo };