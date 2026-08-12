// index.d.ts
//#region tests/rollup-plugin-dts/ts48/index.d.ts
type MyNum = number;
export type SomeNum = "100" extends `${infer U extends MyNum}` ? U : never;
//#endregion