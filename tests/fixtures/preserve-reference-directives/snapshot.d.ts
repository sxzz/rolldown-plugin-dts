// index.d.ts

//#region tests/fixtures/preserve-reference-directives/a.d.ts
declare type JSXElements$1 = keyof JSX.IntrinsicElements;
declare const a: JSXElements$1[];

//#endregion
//#region tests/fixtures/preserve-reference-directives/b.d.ts
declare type JSXElements = keyof JSX.IntrinsicElements;
declare const b: JSXElements[];

//#endregion
export { a, b };