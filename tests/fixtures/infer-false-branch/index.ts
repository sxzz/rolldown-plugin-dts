export type { U } from './mod.ts'

// Test: infer scope only applies to trueType, not falseType
// The U in falseType should reference outer type U, not infer U
type U = 'local'
export type Test<T> =
  T extends Array<infer U> ? (T extends Array<infer U2> ? U2 : U) : U
