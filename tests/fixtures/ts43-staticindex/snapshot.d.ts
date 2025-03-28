// index.d.ts

//#region tests/fixtures/ts43-staticindex/foo.d.ts
interface StaticT {}

//#endregion
//#region tests/fixtures/ts43-staticindex/index.d.ts
declare class Foo {
  static hello: string;
  static world: number;

  static [propName: string]: string | number | StaticT;
}

//#endregion
export { Foo };