// index.d.ts
//#region tests/rollup-plugin-dts/destructured-parameters/mod.d.ts
export declare function f({ value }: {
  value?: string;
}): void;
//#endregion
//#region tests/rollup-plugin-dts/destructured-parameters/index.d.ts
export declare const value: string;
export declare function g({ unused }: {
  unused?: number;
}): void;
//#endregion