// index.d.ts
import { RollupOptions } from "rollup";

//#region tests/fixtures/inline-import-typeof-members/index.d.ts
type TypeScript = typeof import("typescript");
interface Test {
  rollup: RollupOptions;
}

//#endregion
export { Test, TypeScript };