import type { SomeBoolean } from './b'

export interface SomeInterface<T> {
  value: T
}

export type T = SomeBoolean
