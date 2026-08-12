// index.d.ts
//#region tests/rollup-plugin-dts/type-template-literals/foo.d.ts
type Color = "red" | "blue";
type Quantity = "one" | "two";
type VerticalAlignment = "top" | "middle" | "bottom";
type HorizontalAlignment = "left" | "center" | "right";
//#endregion
//#region tests/rollup-plugin-dts/type-template-literals/index.d.ts
export type SeussFish = `${Quantity | Color} fish`;
export declare function setAlignment(value: `${VerticalAlignment}-${HorizontalAlignment}`): void;
//#endregion