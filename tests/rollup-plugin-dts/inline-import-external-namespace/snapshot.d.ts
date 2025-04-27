// index.d.ts
import * as _0 from "foo";
import * as _1 from "foo";

//#region tests/rollup-plugin-dts/inline-import-external-namespace/index.d.ts
interface Foo {
  ns1: _0;
  ns2: typeof _1;
}

//#endregion
export { Foo };