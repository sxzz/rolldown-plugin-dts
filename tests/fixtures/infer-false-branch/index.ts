// Test: infer scope only applies to trueType, not falseType
// The U in falseType should reference outer type U, not infer U
type U = string
export type Test<T> = T extends Array<infer U> ? U : U
