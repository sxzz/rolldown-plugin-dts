// index.d.ts
//#region tests/rollup-plugin-dts/renaming/a.d.ts
interface A$1 {}
interface B$1 {}
interface C$1 {}
interface D$1 {}
interface E$1 {}
interface F$1 {}
declare class Parent$1 {}
declare class Klass extends Parent$1 {
  a: A$1;
}
interface Interface extends B$1 {
  c: C$1;
}
declare function Func(d: D$1): E$1;
declare type Type = {
  f: F$1;
};
//#endregion
//#region tests/rollup-plugin-dts/renaming/b.d.ts
interface A {}
interface B {}
interface C {}
interface D {}
interface E {}
interface F {}
declare class Parent {}
declare class Klass$1 extends Parent {
  a: A;
}
interface Interface$1 extends B {
  c: C;
}
declare function Func$1(d: D): E;
declare type Type$1 = {
  f: F;
};
//#endregion
export { Func as AFunc, Interface as AInterface, Klass as AKlass, Type as AType, Func$1 as BFunc, Interface$1 as BInterface, Klass$1 as BKlass, Type$1 as BType };