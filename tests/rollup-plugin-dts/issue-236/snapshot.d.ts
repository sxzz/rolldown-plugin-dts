// index.d.ts
import React, { MouseEventHandler } from "react";

//#region tests/rollup-plugin-dts/issue-236/index.d.ts
type Props = {
  onClick: MouseEventHandler<HTMLButtonElement>;
};
declare const Button: React.FC<Props>;
//#endregion
export { Button };