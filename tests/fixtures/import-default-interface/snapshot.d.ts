// index.d.ts

//#region tests/fixtures/import-default-interface/bar.d.ts
interface Bar {}
type bar_d_default = Bar

//#endregion
//#region tests/fixtures/import-default-interface/index.d.ts
interface Foo extends bar_d_default {}

//#endregion
export { Foo };