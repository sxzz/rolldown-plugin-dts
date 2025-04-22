// index.d.ts
//#region tests/rollup-plugin-dts/implements-expression/ns.d.ts
declare namespace ns {
  interface Props<T> {
    foo: T;
  }
  class Component<P> {
    props: P;
  }
}

//#endregion
//#region tests/rollup-plugin-dts/implements-expression/index.d.ts
interface G {}
interface MyComponentProps extends ns.Props<G> {
  bar: string;
}
declare class MyComponent extends ns.Component<MyComponentProps> {}

//#endregion
export { MyComponent, MyComponentProps };