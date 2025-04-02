// index.d.ts

//#region tests/fixtures/import-default-interface/bar.d.ts
interface Bar {}

//#endregion
//#region tests/fixtures/import-default-interface/index.d.ts
interface Foo extends Bar {}

//#endregion
export { Foo };