// index.d.ts
//#region tests/rollup-plugin-dts/enum/index.d.ts
declare enum A {
  A = 0,
}
declare enum B {
  B = "B",
}
declare const enum C {
  C = 0,
}
declare const enum D {
  D = "D",
}

//#endregion
export { A, B, C, D };