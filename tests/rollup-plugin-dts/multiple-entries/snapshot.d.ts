// common-CDXWZZLt.d.ts
interface A {}
interface B {}
export { B as n, A as t };
// main-a.d.ts
import { t as A } from "./common-CDXWZZLt.js";
export { A };
// main-b.d.ts
import { n as B } from "./common-CDXWZZLt.js";
export { B };