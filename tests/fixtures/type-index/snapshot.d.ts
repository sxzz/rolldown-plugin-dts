// index.d.ts

//#region tests/fixtures/type-index/index.d.ts
interface A {}
declare type Foo = {
  [k: string]: A;
};

//#endregion
export { Foo };