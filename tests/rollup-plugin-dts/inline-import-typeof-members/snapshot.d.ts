// index.d.ts
//#region tests/rollup-plugin-dts/inline-import-typeof-members/index.d.ts
type TypeScript = typeof import("typescript");
interface Test {
  rollup: import("rollup").RollupOptions;
}
//#endregion
export { Test, TypeScript };