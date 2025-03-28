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
type ns_d_default = ns

//#endregion
//#region tests/fixtures/implements-expression/index.d.ts
interface G {}
interface MyComponentProps extends ns_d_default.Props<G> {
  bar: string;
}
declare class MyComponent extends ns_d_default.Component<MyComponentProps> {}

//#endregion
export { MyComponent, MyComponentProps };