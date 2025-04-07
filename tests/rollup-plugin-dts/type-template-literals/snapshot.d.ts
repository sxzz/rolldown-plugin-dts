// index.d.ts

//#region tests/rollup-plugin-dts/type-template-literals/foo.d.ts
type Color = "red" | "blue";
type Quantity = "one" | "two";
type VerticalAlignment = "top" | "middle" | "bottom";
type HorizontalAlignment = "left" | "center" | "right";

//#endregion
//#region tests/rollup-plugin-dts/type-template-literals/index.d.ts
type SeussFish = `${Quantity | Color} fish`;
declare function setAlignment(value: `${VerticalAlignment}-${HorizontalAlignment}`): void;

//#endregion
export { SeussFish, setAlignment };