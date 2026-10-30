// index.d.ts
declare abstract class A {}
interface B {}
interface C {}
interface D {}
interface E {}
export default class Foo extends A {
  b: B;
  constructor(c: C);
  method(d: D): E;
}
export {};