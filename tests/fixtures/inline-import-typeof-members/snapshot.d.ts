// index.d.ts
import * as rollup from "rollup";
import * as typescript from "typescript";

//#region tests/fixtures/inline-import-typeof-members/index.d.ts
type TypeScript = typeof typescript;
interface Test {
  rollup: rollup.RollupOptions;
}

//#endregion
export { Test, TypeScript };