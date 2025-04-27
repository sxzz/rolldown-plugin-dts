// index.d.ts
import * as _0 from "typescript";
import * as _1 from "rollup";

//#region tests/rollup-plugin-dts/inline-import-typeof-members/index.d.ts
type TypeScript = typeof _0;
interface Test {
  rollup: _1.RollupOptions;
}

//#endregion
export { Test, TypeScript };