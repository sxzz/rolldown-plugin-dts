import { S } from './lib.js'

// `pipe` declares a nested type parameter named `S`, which must not shadow the
// module-scope import that the qualified references resolve to.
export declare const value: S.Struct<{
  readonly name: S.Str
  pipe<A, S = never>(this: A, ab: (_: A) => S): S
}>

// The same collision, plus an `infer S` in the same declaration. The inferred
// reference has to keep binding to the `infer`, not to the type parameter.
export declare const inferred: S.Struct<{
  readonly name: S.Str
  pipe<A, S = never>(this: A, ab: (_: A) => S): S
  unwrap<B>(this: B): B extends Array<infer S> ? S : never
}>
