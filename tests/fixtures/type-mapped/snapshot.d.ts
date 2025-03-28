// index.d.ts

//#region tests/fixtures/type-mapped/index.d.ts
interface A {}
interface B {}
declare type Foo = {
  [P in keyof A]: B[P];
};

//#endregion
export { Foo };