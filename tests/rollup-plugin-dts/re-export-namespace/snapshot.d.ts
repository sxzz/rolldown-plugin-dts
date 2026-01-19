// index.d.ts
declare namespace namespace_d_exports {
  export { A, B, C, D, E, F, GenericC, GenericF, GenericI, GenericT };
}
interface A {}
declare function B(): void;
declare class C {}
declare enum D {
  A = 0,
  B = 1
}
declare const E: string;
declare type F = string;
declare class GenericC<T1, T2> {}
declare function GenericF<T1, T2>(): void;
interface GenericI<T1, T2> {}
declare type GenericT<T1, T2> = GenericI<T1, T2>;
//#endregion
export { namespace_d_exports as ns1, namespace_d_exports as ns2 };