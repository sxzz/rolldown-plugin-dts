// index.d.ts

//#region tests/fixtures/inline-import-typeof-members/index.d.ts
type TypeScript = typeof import("typescript");
interface Test {
  rollup: import("rollup").RollupOptions;
}

//#endregion
export { Test, TypeScript };