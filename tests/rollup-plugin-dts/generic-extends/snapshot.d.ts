// index.d.ts
import { ComponentPropsWithRef, ElementType, ForwardRefExoticComponent } from "react";
//#region tests/rollup-plugin-dts/generic-extends/index.d.ts
export type AnimatedProps<T> = T;
export type AnimatedComponent<T extends ElementType> = ForwardRefExoticComponent<AnimatedProps<ComponentPropsWithRef<T>>>;
//#endregion