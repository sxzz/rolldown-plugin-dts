export const a: string = ''

export const b: string = ''

console.log('Hello World!')

type Str = string
export function fn(param: Str): string {
  return param
}

export interface Obj {
  nested: {
    key: string
  }
  method(): void
  'foo-bar': number
}

export namespace Ns {
  export type Str = string
  export type Foo<T> = T
  export type Obj = {
    id: string
  }
}

export * as Mod from './mod'
