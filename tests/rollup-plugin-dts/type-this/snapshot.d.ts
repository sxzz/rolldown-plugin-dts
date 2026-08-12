// index.d.ts
//#region tests/rollup-plugin-dts/type-this/index.d.ts
declare class Foo {
  a: this;
}
export declare function thisType(this: Foo): void;
//#endregion