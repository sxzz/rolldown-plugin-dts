// index.d.ts

//#region tests/rollup-plugin-dts/type-this/index.d.ts
declare class Foo {
  a: this;
}
declare function thisType(this: Foo): void;

//#endregion
export { thisType };