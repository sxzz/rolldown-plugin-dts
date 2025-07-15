// index.d.ts
import * as typescript0 from "typescript";
import * as rollup0 from "rollup";

//#region tests/rollup-plugin-dts/inline-import-typeof-members/index.d.ts
type TypeScript = typeof typescript0;
interface Test {
  rollup: rollup0.RollupOptions;
}
//#endregion
export { Test, TypeScript };