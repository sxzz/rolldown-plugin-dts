// index.d.ts
//#region rolldown:runtime



//#endregion
//#region tests/rollup-plugin-dts/re-export-namespace-multiple/defs.d.ts

declare namespace defs_d_exports {
  export { A, B, C, D, E, F, }
}
interface A {}
declare function B(): void;
declare class C {}
declare enum D {
  A = 0,
  B = 1,
}
declare const E: string;
declare type F = string;

//#endregion
//#region tests/rollup-plugin-dts/re-export-namespace-multiple/deep.d.ts

declare namespace deep_d_exports {
  export { defs_d_exports as ns, }
}

//#endregion
//#region tests/rollup-plugin-dts/re-export-namespace-multiple/only-one.d.ts

declare namespace only_one_d_exports {
  export { A, }
}

//#endregion
//#region tests/rollup-plugin-dts/re-export-namespace-multiple/index.d.ts
interface WithA {
  a: A;
}

//#endregion
export { WithA, deep_d_exports as deep, defs_d_exports as ns, only_one_d_exports as onlyOne };