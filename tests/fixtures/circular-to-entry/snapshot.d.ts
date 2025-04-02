// index.d.ts

//#region tests/fixtures/circular-to-entry/Foo.d.ts
declare class Foo {
  manager: FooManager;
  constructor(manager: FooManager);
}

//#endregion
//#region tests/fixtures/circular-to-entry/index.d.ts
declare class FooManager {
  foos: Array<Foo>;
  constructor();
}

//#endregion
export { FooManager as default };