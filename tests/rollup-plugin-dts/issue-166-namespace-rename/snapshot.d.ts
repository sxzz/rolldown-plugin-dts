// index.d.ts
//#region tests/rollup-plugin-dts/issue-166-namespace-rename/a.d.ts
declare const Item$1: () => void;
declare namespace A {
  export { Item$1 as Item };
}
//#endregion
//#region tests/rollup-plugin-dts/issue-166-namespace-rename/b.d.ts
declare const Item: () => void;
declare namespace B {
  export { Item };
}
//#endregion
export { A, B };