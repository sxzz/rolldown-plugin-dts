// index.d.ts
import { inspect } from "util";

//#region tests/fixtures/computed-method/b.d.ts
declare const b: "b";

//#endregion
//#region tests/fixtures/computed-method/mod.d.ts
declare const deep: { deep: { a: "deep" } };

//#endregion
//#region tests/fixtures/computed-method/index.d.ts
declare class Test {
  [inspect.custom](): string;
  [b](): string;
  [deep.deep.a]: string;
}

//#endregion
export { Test };