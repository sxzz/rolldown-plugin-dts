// index.d.ts
import A from "a";
import D from "d";
import { B } from "b";
import { E, E as E3 } from "e";
import { G1 } from "g1";
import { B as B1 } from "b1";
import { E as E4 } from "e3";
import * as C from "c";
import * as F from "f";
import { G } from "g";
import { J } from "j";
import { L } from "l";
import { H as H1 } from "h1";
import { K as K1 } from "k1";
import { M as M1 } from "m1";
import * as I from "i";
import * as O from "o";
export * from "i1";
export * from "n";

//#region tests/rollup-plugin-dts/type-only-import-export/foo.d.ts
interface Foo {}
//#endregion
//#region tests/rollup-plugin-dts/type-only-import-export/bar.d.ts
declare class BarType {}
declare class BarValue {}
//#endregion
//#region tests/rollup-plugin-dts/type-only-import-export/index.d.ts

interface O$1 {}
declare class X {}
interface Foo$1 {
  inline: string;
}
//#endregion
export { A, type B, type B1 as B2, type B1 as B3, BarType, BarValue, C, C as C1, type D, type E3 as E2, E3, E4, F, type Foo, type Foo$1 as FooInlne, G, G1, H1, I, type J, type K1, type L, type M1, type O, O$1 as O1, type X, E as default };