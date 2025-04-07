// index.d.ts

//#region tests/rollup-plugin-dts/ts43-templatestring/index.d.ts
declare function foo<V extends string>(arg: `*${V}*`): V;

//#endregion
export { foo };