// Regression test for the "Lexical environment is suspended" crash: a get/set
// accessor inside an object type literal in a function signature. Emitting the
// declaration used to crash the `stripPrivateFields` transformer.
// See https://github.com/sxzz/rolldown-plugin-dts/issues/258
export function makeBox(): { get value(): number } {
  return {
    get value() {
      return 1
    },
  }
}
