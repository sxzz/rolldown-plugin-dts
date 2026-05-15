// common-AkXVRtKo.d.ts
/// <reference types="node" />
//#region tests/rollup-plugin-dts/issue-128-reference-directive/common.d.ts
interface B {}
//#endregion
export { B as t };
// main-a.d.ts
/// <reference types="jest" />
/// <reference types="react" />
import { t as B } from "./common-AkXVRtKo.js";

//#region tests/rollup-plugin-dts/issue-128-reference-directive/ref-from-a.d.ts
declare const A = 2;
//#endregion
//#region tests/rollup-plugin-dts/issue-128-reference-directive/main-a.d.ts
declare type JSXElements = keyof JSX.IntrinsicElements;
declare const a: JSXElements[];
//#endregion
export { A, B, JSXElements, a };
// main-b.d.ts
import { t as B } from "./common-AkXVRtKo.js";
export { B };