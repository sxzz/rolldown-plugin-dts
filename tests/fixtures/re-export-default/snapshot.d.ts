// index.d.ts

//#region tests/fixtures/re-export-default/default1.d.ts
declare class Foo {}

//#endregion
//#region tests/fixtures/re-export-default/default2.d.ts
declare class Foo$1 {}

//#endregion
export { Foo as default, Foo$1 as default2 };