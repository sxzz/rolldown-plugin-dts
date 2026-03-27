// index.d.ts
import * as _$typescript from "typescript";
import * as _$rollup from "rollup";

//#region tests/rollup-plugin-dts/inline-import-typeof-members/index.d.ts
type TypeScript = typeof _$typescript;
interface Test {
  rollup: _$rollup.RollupOptions;
}
//#endregion
export { Test, TypeScript };