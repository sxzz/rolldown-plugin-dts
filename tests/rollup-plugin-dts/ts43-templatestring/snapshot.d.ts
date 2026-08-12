// index.d.ts
//#region tests/rollup-plugin-dts/ts43-templatestring/index.d.ts
export declare function foo<V extends string>(arg: `*${V}*`): V;
//#endregion