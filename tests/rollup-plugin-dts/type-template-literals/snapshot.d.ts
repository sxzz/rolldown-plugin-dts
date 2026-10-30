// index.d.ts
type Color = "red" | "blue";
type Quantity = "one" | "two";
type VerticalAlignment = "top" | "middle" | "bottom";
type HorizontalAlignment = "left" | "center" | "right";
export type SeussFish = `${Quantity | Color} fish`;
export declare function setAlignment(value: `${VerticalAlignment}-${HorizontalAlignment}`): void;
export {};