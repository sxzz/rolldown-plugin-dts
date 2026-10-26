// index.d.ts
import { ComponentPropsWithRef, ElementType, ForwardRefExoticComponent } from "react";
export type AnimatedProps<T> = T;
export type AnimatedComponent<T extends ElementType> = ForwardRefExoticComponent<AnimatedProps<ComponentPropsWithRef<T>>>;