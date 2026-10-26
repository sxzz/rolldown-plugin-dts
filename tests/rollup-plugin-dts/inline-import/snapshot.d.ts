// index.d.ts
interface Bar {}
declare const Baz = 123;
export interface Foo {
  bar: Bar;
  baz: typeof Baz;
}
export {};