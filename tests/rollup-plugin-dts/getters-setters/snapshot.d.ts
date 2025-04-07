// index.d.ts

//#region tests/rollup-plugin-dts/getters-setters/index.d.ts
interface A {}
interface B {}
interface C {}
declare class D {
  get a(): A;
  get b(): B;
  set b(_: B);
  readonly c: C;
}

//#endregion
export { D };