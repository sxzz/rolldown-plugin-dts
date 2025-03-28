// index.d.ts
import React, { MouseEventHandler } from "react";

//#region tests/fixtures/issue-236/index.d.ts
type Props = {
  onClick: MouseEventHandler<HTMLButtonElement>;
};
declare const Button: React.FC<Props>;

//#endregion
export { Button };