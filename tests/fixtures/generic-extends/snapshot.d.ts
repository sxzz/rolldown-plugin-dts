// index.d.ts
import { ComponentPropsWithRef, ElementType, ForwardRefExoticComponent } from "react";

//#region tests/fixtures/generic-extends/index.d.ts
type AnimatedProps<T> = T;
type AnimatedComponent<T extends ElementType> = ForwardRefExoticComponent<
  AnimatedProps<ComponentPropsWithRef<T>>
>;

//#endregion
export { AnimatedComponent, AnimatedProps };