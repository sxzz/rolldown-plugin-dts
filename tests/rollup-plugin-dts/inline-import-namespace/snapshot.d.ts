// index.d.ts
declare class Bar {}
interface IBar {}
//#endregion
//#region tests/rollup-plugin-dts/inline-import-namespace/index.d.ts
interface Foo {
  ns: {
    Bar: typeof Bar;
  };
}
//#endregion
export { Foo };