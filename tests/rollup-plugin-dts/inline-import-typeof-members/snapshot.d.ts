// index.d.ts
import { RollupOptions } from "rollup";
import * as _0 from "typescript";

//#region tests/rollup-plugin-dts/inline-import-typeof-members/index.d.ts
type TypeScript = typeof _0;
interface Test {
  rollup: RollupOptions;
}

//#endregion
export { Test, TypeScript };