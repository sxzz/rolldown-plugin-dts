// index.d.ts
//#region tests/rollup-plugin-dts/ts47/index.d.ts
interface Hammer {}
type FirstHammer<T> = T extends [infer H extends Hammer, ...unknown[]] ? H : never;
interface State<in out T> {
  get: () => T;
  set: (value: T) => void;
}

//#endregion
export { FirstHammer, State };