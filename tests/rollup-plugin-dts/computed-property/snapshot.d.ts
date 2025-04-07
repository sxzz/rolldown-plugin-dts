// index.d.ts

//#region tests/rollup-plugin-dts/computed-property/index.d.ts
declare const Aprop: "a";
declare const Dprop: unique symbol;
interface A {}
interface B {}
interface C {}
interface D {}
type Klass = {
  [Aprop]?: A[];
  ["B"]: B;
  [0]: C;
  [Dprop]: D;
};

//#endregion
export { Klass };