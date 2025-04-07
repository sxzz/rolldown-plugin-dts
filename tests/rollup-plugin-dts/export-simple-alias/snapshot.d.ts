// index.d.ts

//#region tests/rollup-plugin-dts/export-simple-alias/index.d.ts
interface Foo {}
declare type Bar = Foo;

//#endregion
export { Bar };