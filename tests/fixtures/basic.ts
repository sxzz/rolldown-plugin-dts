export const foo: number = 42

type SomeType<T> = T
type FooType = string
interface Interface {}

export function fn(arg0: SomeType<FooType>, opt: Interface): void {}

export enum Enum {
  A = 0,
  B = 1,
  C = 2,
}

export class Cls {
  foo: string
  fn(e: Enum): void {}
}
