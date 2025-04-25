// common.d-I_HN9Sub.d.ts
//#region tests/rollup-plugin-dts/multiple-entries/common.d.ts
interface A {}
interface B {}

//#endregion
export { A, B };
// main-a.d.ts
import { A } from "./common.d-I_HN9Sub.js";

export { A };
// main-b.d.ts
import { B } from "./common.d-I_HN9Sub.js";

export { B };