// index.d.ts

//#region tests/rollup-plugin-dts/export-multiple-vars/settings.d.ts
declare type In = { a: string };
declare type Out = { b: number };

//#endregion
//#region tests/rollup-plugin-dts/export-multiple-vars/util.d.ts
declare const config: {
  normalize: (inVar: In) => Out;
};
declare const options: {
  normalize: (inVar: In) => Out;
};
declare const params: {
  normalize: (inVar: In) => Out;
};

//#endregion
export { In, Out, config, options, params };