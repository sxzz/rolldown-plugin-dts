// index.d.ts
//#region tests/rollup-plugin-dts/re-export-default/default1.d.ts
declare class Foo {}

//#endregion
//#region tests/rollup-plugin-dts/re-export-default/default2.d.ts
declare class Foo$1 {}

//#endregion
export { Foo as default, Foo$1 as default2 };