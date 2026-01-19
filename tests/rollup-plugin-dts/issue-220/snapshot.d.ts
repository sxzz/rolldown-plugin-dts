// index.d.ts
//#region tests/rollup-plugin-dts/issue-220/index.d.ts
declare enum Alphabet {
  a = "a",
  b = "b"
}
declare class Test {
  readonly letter = Alphabet.a;
}
//#endregion
export { Test };