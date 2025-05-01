// common-VNQ3nt5C.d.ts
//#region tests/rollup-plugin-dts/multiple-entries/common.d.ts
interface A {}
interface B {}

//#endregion
export { A, B };
// main-a.d.ts
import { A } from "./common-VNQ3nt5C.js";
export { A };
// main-b.d.ts
import { B } from "./common-VNQ3nt5C.js";
export { B };