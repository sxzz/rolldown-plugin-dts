// index.d.ts

//#region tests/fixtures/namespace-definition/index.d.ts
declare function fn(arg: string): string;
declare namespace fn {
  var staticProp: string;
}

//#endregion
export { fn };