// index.d.ts
import * as foo from "foo";
import * as foo_bar from "foo_bar";
import * as foo_bar0 from "foo-bar";
import * as foo_bar1 from "foo.bar";
import * as foo_bar2 from "foo/bar";

//#region tests/rollup-plugin-dts/inline-import-external-namespace/index.d.ts
interface Foo {
  ns1: foo;
  ns2: typeof foo;
  ns3: foo_bar.T;
  ns4: foo_bar0.T;
  ns5: foo_bar1.T;
  ns6: foo_bar2.T;
}
//#endregion
export { Foo };