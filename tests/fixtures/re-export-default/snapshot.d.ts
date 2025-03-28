// index.d.ts

//#region tests/fixtures/re-export-default/default1.d.ts
declare class Foo$1 {}
type default1_d_default = Foo$1

//#endregion
//#region tests/fixtures/re-export-default/default2.d.ts
declare class Foo {}
type default2_d_default = Foo

//#endregion
export { default1_d_default as default, default2_d_default as default2 };