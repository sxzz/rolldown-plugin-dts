// common-dMrhAevA.d.ts
/// <reference types="node" />
//#region tests/rollup-plugin-dts/issue-128-reference-directive/common.d.ts
interface B {}

//#endregion
export { B };
// main-a.d.ts
/// <reference types="jest" />
/// <reference types="react" />
import { B } from "./common-dMrhAevA.js";

//#region tests/rollup-plugin-dts/issue-128-reference-directive/ref-from-a.d.ts
declare const A = 2;

//#endregion
//#region tests/rollup-plugin-dts/issue-128-reference-directive/main-a.d.ts
declare type JSXElements = keyof JSX.IntrinsicElements;
declare const a: JSXElements[];

//#endregion
export { A, B, JSXElements, a };
// main-b.d.ts
import { B } from "./common-dMrhAevA.js";
export { B };