// index.d.ts
import * as typescript from "typescript";
import * as rollup from "rollup";

//#region tests/rollup-plugin-dts/inline-import-typeof-members/index.d.ts
type TypeScript = typeof typescript;
interface Test {
  rollup: rollup.RollupOptions;
}
//#endregion
export { Test, TypeScript };