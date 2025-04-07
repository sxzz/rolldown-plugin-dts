// index.d.ts

//#region tests/rollup-plugin-dts/namespace-definition-rename/a.d.ts
declare function fn(arg: string): string;
declare namespace fn {
  var staticProp: string;
}

//#endregion
//#region tests/rollup-plugin-dts/namespace-definition-rename/b.d.ts
declare function fn$1(arg: string): string;
declare namespace fn$1 {
  var staticProp: string;
}

//#endregion
export { fn as a, fn$1 as b };