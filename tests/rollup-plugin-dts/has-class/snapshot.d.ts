// index.d.ts
//#region tests/rollup-plugin-dts/has-class/foo.d.ts
declare abstract class A {}
interface B {}
interface C {}
interface D {}
interface E {}
//#endregion
//#region tests/rollup-plugin-dts/has-class/index.d.ts
export default class Foo extends A {
  b: B;
  constructor(c: C);
  method(d: D): E;
}
//#endregion