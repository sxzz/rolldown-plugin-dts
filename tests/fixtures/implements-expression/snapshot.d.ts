// index.d.ts

//#region tests/fixtures/implements-expression/ns.d.ts
declare namespace ns {
  interface Props<T> {
    foo: T;
  }
  class Component<P> {
    props: P;
  }
}

//#endregion
//#region tests/fixtures/implements-expression/index.d.ts
interface G {}
interface MyComponentProps extends ns.Props<G> {
  bar: string;
}
declare class MyComponent extends ns.Component<MyComponentProps> {}

//#endregion
export { MyComponent, MyComponentProps };