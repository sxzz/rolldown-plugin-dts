// index.d.ts

//#region tests/rollup-plugin-dts/import-default-interface/bar.d.ts
interface Bar {}

//#endregion
//#region tests/rollup-plugin-dts/import-default-interface/index.d.ts
interface Foo extends Bar {}

//#endregion
export { Foo };