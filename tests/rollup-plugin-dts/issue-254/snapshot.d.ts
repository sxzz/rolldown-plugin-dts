// index.d.ts
//#region tests/rollup-plugin-dts/issue-254/foo.d.ts
declare enum E {}
interface Foo {
  e: E;
}
declare namespace Bar {
  export enum F {}
} //#endregion
export { Bar, Foo };