// common.d-CTbT7kRK.d.ts
//#region tests/rollup-plugin-dts/issue-128-reference-directive/common.d.ts
/// <reference types="node" />
interface B {}

//#endregion
export { B };
// main-a.d.ts
/// <reference types="jest" />
/// <reference types="react" />
import { B } from "./common.d-CTbT7kRK.js";

//#region tests/rollup-plugin-dts/issue-128-reference-directive/ref-from-a.d.ts
declare const A = 2;

//#endregion
//#region tests/rollup-plugin-dts/issue-128-reference-directive/main-a.d.ts
declare type JSXElements = keyof JSX.IntrinsicElements;
declare const a: JSXElements[];

//#endregion
export { A, B, JSXElements, a };
// main-b.d.ts
import { B } from "./common.d-CTbT7kRK.js";
export { B };