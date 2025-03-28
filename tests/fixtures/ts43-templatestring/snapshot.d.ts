// index.d.ts

//#region tests/fixtures/ts43-templatestring/index.d.ts
declare function foo<V extends string>(arg: `*${V}*`): V;

//#endregion
export { foo };