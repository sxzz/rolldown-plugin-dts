import type { SomeInterface } from './a'

export class SomeClass<T extends SomeInterface<number>> {
  constructor(public value: T) {}

  public doSomething<T extends SomeInterface<number>>(value: T): T {
    return value
  }
}

export type SomeBoolean = boolean
