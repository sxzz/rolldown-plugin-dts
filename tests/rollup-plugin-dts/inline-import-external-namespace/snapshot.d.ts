// index.d.ts
import * as _$foo from "foo";
import * as _$foo_bar from "foo_bar";
import * as _$foo_bar0 from "foo-bar";
import * as _$foo_bar1 from "foo.bar";
import * as _$foo_bar2 from "foo/bar";

//#region tests/rollup-plugin-dts/inline-import-external-namespace/index.d.ts
interface Foo {
  ns1: _$foo;
  ns2: typeof _$foo;
  ns3: _$foo_bar.T;
  ns4: _$foo_bar0.T;
  ns5: _$foo_bar1.T;
  ns6: _$foo_bar2.T;
}
//#endregion
export { type Foo };