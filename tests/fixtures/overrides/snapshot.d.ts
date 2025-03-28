// index.d.ts

//#region tests/fixtures/overrides/index.d.ts
interface A {}
interface B {}
interface C {}
interface D {}
interface E {}
interface F {}
declare class Foo {
  constructor(a: A);
  constructor(b: B);
  method(c: C): D;
  method(e: E): F;
}
type index_d_default = Foo

//#endregion
export { index_d_default as default };