// index.d.ts
//#region tests/rollup-plugin-dts/type-mapped/index.d.ts
interface A {}
interface B {}
export declare type Foo = { [P in keyof A]: B[P]; };
//#endregion