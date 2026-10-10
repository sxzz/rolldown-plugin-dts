// index.d.ts
//#region tests/rollup-plugin-dts/namespace-references/ns.d.ts
interface Referenced1 {}
interface Referenced2 {}
export declare namespace ns {
  class Shadowed1 {}
  enum Shadowed2 {}
  type Shadowed3 = undefined;
  function Shadowed4(): void;
  interface A {
    a: Referenced1;
    b: Shadowed1;
    c: Shadowed2;
    d: Shadowed3;
    e: typeof Shadowed4;
  }
  namespace childNS {
    export { Referenced2 as ref };
  }
}
//#endregion