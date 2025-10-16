// index.d.ts
//#region tests/rollup-plugin-dts/generics/index.d.ts
interface A {}
interface B {}
interface C {}
interface D {}
interface E {}
interface F {}
interface G {}
interface H {}
interface J {}
interface K {}
interface L {}
interface M {}
interface N {}
interface O {}
interface P {}
declare type Gen<T$1> = T$1;
interface I1<T$1 = A> {
  a: T$1;
  b: Gen<B>;
}
declare type Ty<T$1 = C> = {
  c: T$1;
  d: Gen<D>;
};
declare class Cl<T$1 = E> {
  e: T$1;
  f: Gen<F>;
}
declare function fn<T$1 = G>(g: T$1, h: Gen<H>): void;
declare type TyFn = <T = J>(j: T, k: Gen<K>) => L;
declare type TyCtor = new <T = M>(m: T, n: Gen<N>) => O;
interface I2 extends Gen<P> {}
//#endregion
export { Cl, I1, I2, Ty, TyCtor, TyFn, fn };