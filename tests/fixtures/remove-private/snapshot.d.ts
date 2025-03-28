// index.d.ts

//#region tests/fixtures/remove-private/index.d.ts
declare class B {}
declare class Foo {
  private a;
  protected b: B;
  private ma;
  protected mb(): void;
}

//#endregion
export { Foo };