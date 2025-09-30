// index.d.ts
//#region tests/rollup-plugin-dts/typeof-this/index.d.ts
declare class Test {
  functionOne(foo: string, bar: number): void;
  functionTwo(...args: Parameters<typeof this.functionOne>): void;
}
//#endregion
export { Test };