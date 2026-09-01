// index.d.ts
//#region tests/rollup-plugin-dts/issue-254/foo.d.ts
declare enum E {}
export interface Foo {
  e: E;
}
export declare namespace Bar {
  export enum F {}
}
//#endregion