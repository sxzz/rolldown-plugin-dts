// index.d.ts

//#region tests/fixtures/issue-89-import-equals/bar.d.ts
interface Foo {}
type bar_d_default = Foo

//#endregion
export { bar_d_default as Foo };