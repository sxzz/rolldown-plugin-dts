// index.d.ts
//#region tests/rollup-plugin-dts/type-typeof/index.d.ts
interface A {}
declare const a: A;
export declare function typeQuery(): typeof a;
//#endregion