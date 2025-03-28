// index.d.ts
import React from "react";

//#region tests/fixtures/react-components/index.d.ts
interface MyComponentProps extends React.HtmlHTMLAttributes<HTMLDivElement> {
  foo: string;
}
declare class MyComponent extends React.Component<MyComponentProps> {}

//#endregion
export { MyComponent, MyComponentProps };