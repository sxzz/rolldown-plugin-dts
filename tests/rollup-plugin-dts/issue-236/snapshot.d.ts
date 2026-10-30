// index.d.ts
import React, { MouseEventHandler } from "react";
type Props = {
  onClick: MouseEventHandler<HTMLButtonElement>;
};
export declare const Button: React.FC<Props>;
export {};