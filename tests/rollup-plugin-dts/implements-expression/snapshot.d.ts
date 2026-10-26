// index.d.ts
declare namespace ns {
  interface Props<T> {
    foo: T;
  }
  class Component<P> {
    props: P;
  }
}
interface G {}
export interface MyComponentProps extends ns.Props<G> {
  bar: string;
}
export declare class MyComponent extends ns.Component<MyComponentProps> {}
export {};