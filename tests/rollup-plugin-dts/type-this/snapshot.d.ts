// index.d.ts
declare class Foo {
  a: this;
}
export declare function thisType(this: Foo): void;
export {};