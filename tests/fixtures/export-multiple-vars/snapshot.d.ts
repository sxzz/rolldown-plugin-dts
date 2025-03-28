// index.d.ts

//#region tests/fixtures/export-multiple-vars/settings.d.ts
declare type In = { a: string };
declare type Out = { b: number };

//#endregion
//#region tests/fixtures/export-multiple-vars/util.d.ts
declare const config: {
  normalize: (inVar: import("./settings").In) => import("./settings").Out;
};
declare const options: {
  normalize: (inVar: import("./settings").In) => import("./settings").Out;
};
declare const params: {
  normalize: (inVar: import("./settings").In) => import("./settings").Out;
};

//#endregion
export { In, Out, config, options, params };