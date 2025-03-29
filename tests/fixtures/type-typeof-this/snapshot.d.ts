// index.d.ts

//#region tests/fixtures/type-typeof-this/index.d.ts
declare class NumberSchema {
  min: () => typeof this;
}

//#endregion
export { NumberSchema };