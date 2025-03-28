// index.d.ts

//#region tests/fixtures/type-typeof-this/index.d.ts
declare class NumberSchema {
  min: () => typeof void 0;
}

//#endregion
export { NumberSchema };