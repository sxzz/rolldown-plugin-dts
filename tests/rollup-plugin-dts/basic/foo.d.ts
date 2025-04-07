import * as mod from './mod.js'
export declare const foo: number
export declare const bar: typeof mod.a
type SomeType<T> = T
type FooType = string
interface Interface {}
export declare function fn(arg0: SomeType<FooType>, opt: Interface): void
declare enum Enum {
  A = 0,
  B = 1,
  C = 2,
}
export declare class Cls {
  foo: string
  fn(e: Enum): void
}
export {}
