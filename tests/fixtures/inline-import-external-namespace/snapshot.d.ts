// index.d.ts
import * as foo from "foo";

//#region tests/fixtures/inline-import-external-namespace/index.d.ts
interface Foo {
  ns1: foo;
  ns2: typeof foo;
}

//#endregion
export { Foo };