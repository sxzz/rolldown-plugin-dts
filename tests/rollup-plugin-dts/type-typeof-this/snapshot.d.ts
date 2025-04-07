// index.d.ts

//#region tests/rollup-plugin-dts/type-typeof-this/index.d.ts
declare class NumberSchema {
  min: () => typeof this;
}

//#endregion
export { NumberSchema };