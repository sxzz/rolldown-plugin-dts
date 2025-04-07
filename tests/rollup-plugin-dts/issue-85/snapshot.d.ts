// index.d.ts

//#region tests/rollup-plugin-dts/issue-85/foo.d.ts
declare function foo(): {
  bar: (blah: any, hi: any) => void;
};

//#endregion
export { foo };