// index.d.ts
//#region tests/rollup-plugin-dts/type-conditional/index.d.ts
interface A {}
interface B {}
interface C {}
export declare type Foo = A extends B ? C : never;
//#endregion