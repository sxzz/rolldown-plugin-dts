// index.d.ts
//#region tests/rollup-plugin-dts/inline-import-typeof-members/index.d.ts
export type TypeScript = typeof import("typescript");
export interface Test {
  rollup: import("rollup").RollupOptions;
}
//#endregion