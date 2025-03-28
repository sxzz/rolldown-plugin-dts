// index.d.ts

//#region tests/fixtures/circular-to-entry/Foo.d.ts
declare class Foo {
  manager: index_d_default;
  constructor(manager: index_d_default);
}
type Foo_d_default = Foo

//#endregion
//#region tests/fixtures/circular-to-entry/index.d.ts
declare class FooManager {
  foos: Array<Foo_d_default>;
  constructor();
}
type index_d_default = FooManager

//#endregion
export { index_d_default as default };