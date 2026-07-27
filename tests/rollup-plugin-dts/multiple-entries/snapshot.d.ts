// common-N3buiYs0.d.ts
//#region tests/rollup-plugin-dts/multiple-entries/common.d.ts
interface A {}
interface B {}
//#endregion
export { B as n, A as t };
// main-a.d.ts
import { t as A } from "./common-N3buiYs0.js";
export { A };
// main-b.d.ts
import { n as B } from "./common-N3buiYs0.js";
export { B };