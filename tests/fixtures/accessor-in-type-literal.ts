// Regression test for the "Lexical environment is suspended" crash: a get/set
// accessor inside an object type literal in a function signature. Emitting the
// declaration used to crash the `stripPrivateFields` transformer.
export function makeBox(): { get value(): number } {
  return {
    get value() {
      return 1
    },
  }
}
