// index.d.ts
declare namespace bar_d_exports {
  export { Bar, IBar };
}
declare class Bar {}
interface IBar {}
export interface Foo {
  ns: typeof bar_d_exports;
}
export {};