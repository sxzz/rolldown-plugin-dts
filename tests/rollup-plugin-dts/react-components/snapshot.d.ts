// index.d.ts
import React from "react";
//#region tests/rollup-plugin-dts/react-components/index.d.ts
export interface MyComponentProps extends React.HtmlHTMLAttributes<HTMLDivElement> {
  foo: string;
}
export declare class MyComponent extends React.Component<MyComponentProps> {}
//#endregion