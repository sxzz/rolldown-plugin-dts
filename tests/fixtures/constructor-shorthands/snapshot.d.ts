// index.d.ts

//#region tests/fixtures/constructor-shorthands/index.d.ts
interface A {}
declare class B {}
declare class Foo {
  private a;
  protected b: B;
  constructor(a: A, b: B);
}

//#endregion
export { Foo };