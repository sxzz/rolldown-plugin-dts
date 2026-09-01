// index.d.ts
//#region tests/rollup-plugin-dts/export-multiple-vars/settings.d.ts
export declare type In = {
  a: string;
};
export declare type Out = {
  b: number;
};
//#endregion
//#region tests/rollup-plugin-dts/export-multiple-vars/util.d.ts
export declare const config: {
  normalize: (inVar: In) => Out;
};
export declare const options: {
  normalize: (inVar: In) => Out;
};
export declare const params: {
  normalize: (inVar: In) => Out;
};
//#endregion