// index.d.ts
//#region tests/rollup-plugin-dts/remove-private/index.d.ts
declare class B {}
declare class Foo {
  private a;
  protected b: B;
  private ma;
  protected mb(): void;
}
//#endregion
export { Foo };