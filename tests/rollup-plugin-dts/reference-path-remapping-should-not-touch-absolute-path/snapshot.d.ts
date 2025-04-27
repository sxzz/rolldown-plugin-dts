// index.d.ts
//#region tests/rollup-plugin-dts/reference-path-remapping-should-not-touch-absolute-path/index.d.ts
/// <reference path="/some/absolute/path" />

interface Hello {}
//#endregion
export { Hello };