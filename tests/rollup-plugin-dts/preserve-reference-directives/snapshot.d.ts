// index.d.ts
//#region tests/rollup-plugin-dts/preserve-reference-directives/a.d.ts
/// <reference types="react" />
declare type JSXElements$1 = keyof JSX.IntrinsicElements;
declare const a: JSXElements$1[];

//#endregion
//#region tests/rollup-plugin-dts/preserve-reference-directives/b.d.ts
declare type JSXElements = keyof JSX.IntrinsicElements;
declare const b: JSXElements[];

//#endregion
export { a, b };