// common-BJv-kqK_.d.ts
/// <reference types="node" />
interface B {}
export { B as t };
// main-a.d.ts
/// <reference types="jest" />
/// <reference types="react" />
import { t as B } from "./common-BJv-kqK_.js";
export declare const A = 2;
declare type JSXElements = keyof JSX.IntrinsicElements;
declare const a: JSXElements[];
export { B, JSXElements, a };
// main-b.d.ts
import { t as B } from "./common-BJv-kqK_.js";
export { B };