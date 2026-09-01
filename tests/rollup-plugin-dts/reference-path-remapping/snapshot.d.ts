// index.d.ts
/// <reference path="./ns-api2.d.ts" />
/// <reference path="./ns-api.d.ts" />
//#region tests/rollup-plugin-dts/reference-path-remapping/sub/api2.d.ts
export declare class C2 {
  public X: x2.I2;
}
//#endregion
//#region tests/rollup-plugin-dts/reference-path-remapping/index.d.ts
export declare class C1 {
  public X: x1.I1;
}
//#endregion