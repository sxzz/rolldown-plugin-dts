// index.d.ts
interface Bar<T> {
  t: T;
}
export interface Foo {
  bar: Bar<number>;
}
export {};