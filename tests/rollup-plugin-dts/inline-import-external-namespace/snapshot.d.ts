// index.d.ts
import * as foo0 from "foo";

//#region tests/rollup-plugin-dts/inline-import-external-namespace/index.d.ts
interface Foo {
  ns1: foo0;
  ns2: typeof foo0;
}
//#endregion
export { Foo };