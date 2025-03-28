// index.d.ts
import A from "a";
import { E, E as E3 } from "e";
import { G1 } from "g1";
import { E as E4 } from "e3";
import * as C from "c";
import * as F from "f";
import { G } from "g";
import { H as H1 } from "h1";
import * as I from "i";

export * from "i1"

//#region tests/fixtures/type-only-import-export/bar.d.ts
declare class BarType { }
declare class BarValue { }

//#endregion
//#region tests/fixtures/type-only-import-export/index.d.ts
type index_d_default = E
interface O {}

//#endregion
export { A, BarType, BarValue, C, C as C1, E3, E4, F, G, G1, H1, I, O as O1, index_d_default as default };