import type { Item } from '@fixture/model'

export interface Wrapper<T> {
  readonly item: Item
  readonly value: T
}
