// index.d.ts
//#region tests/rollup-plugin-dts/basic/mod.d.ts
declare const a: string;

//#endregion
//#region tests/rollup-plugin-dts/basic/foo.d.ts
declare const foo: number;
declare const bar: typeof a;
type SomeType<T> = T;
type FooType = string;
interface Interface {}
declare function fn(arg0: SomeType<FooType>, opt: Interface): void;
declare enum Enum {
  A = 0,
  B = 1,
  C = 2,
}
declare class Cls {
  foo: string;
  fn(e: Enum): void;
}

//#endregion
export { Cls, bar, fn, foo };