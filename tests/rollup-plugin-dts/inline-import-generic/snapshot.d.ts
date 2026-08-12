// index.d.ts
//#region tests/rollup-plugin-dts/inline-import-generic/bar.d.ts
interface Bar<T> {
  t: T;
}
//#endregion
//#region tests/rollup-plugin-dts/inline-import-generic/index.d.ts
export interface Foo {
  bar: Bar<number>;
}
//#endregion