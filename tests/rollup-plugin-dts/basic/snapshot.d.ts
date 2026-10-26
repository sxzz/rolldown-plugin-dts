// index.d.ts
declare const a: string;
declare const foo: number;
export declare const bar: typeof a;
type SomeType<T> = T;
type FooType = string;
interface Interface {}
declare function fn(arg0: SomeType<FooType>, opt: Interface): void;
declare enum Enum {
  A = 0,
  B = 1,
  C = 2
}
declare class Cls {
  foo: string;
  fn(e: Enum): void;
}
export type { Cls, fn, foo };