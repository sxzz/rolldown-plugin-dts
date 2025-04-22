// index.d.ts
//#region tests/rollup-plugin-dts/type-index/index.d.ts
interface A {}
declare type Foo = {
  [k: string]: A;
};

//#endregion
export { Foo };