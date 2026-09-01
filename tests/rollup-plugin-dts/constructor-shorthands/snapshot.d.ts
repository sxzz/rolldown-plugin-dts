// index.d.ts
//#region tests/rollup-plugin-dts/constructor-shorthands/index.d.ts
interface A {}
declare class B {}
export declare class Foo {
  private a;
  protected b: B;
  constructor(a: A, b: B);
}
//#endregion