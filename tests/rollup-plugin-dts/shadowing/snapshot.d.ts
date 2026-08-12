// index.d.ts
//#region tests/rollup-plugin-dts/shadowing/exports.d.ts
interface J {}
export declare class GenericKlass<A = any, B = A> {
  a: A;
  b: B;
}
export interface GenericInterface<C = any, D = C> {
  c: C;
  d: D;
}
export declare function genericFunction<E = any, F = E>(e: E): F;
export declare type ConditionalInfer<G> = G extends Array<Array<infer H>> ? H : never;
export declare type Mapped<I> = { [J in keyof I]: I[J]; };
export declare type GenericType<K = any, L = K> = {
  k: K;
  l: L;
};
export interface GenericExtends<M = any, N = M> extends GenericInterface<M, N> {}
//#endregion