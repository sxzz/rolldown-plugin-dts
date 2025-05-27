// common-BCs1CRq6.d.ts
//#region tests/rollup-plugin-dts/multiple-entries/common.d.ts
interface A {}
interface B {}
//#endregion
export { A, B };
// main-a.d.ts
import { A } from "./common-BCs1CRq6.js";
export { A };
// main-b.d.ts
import { B } from "./common-BCs1CRq6.js";
export { B };