## index.d.ts

```ts
declare namespace mod_d_exports {
  export { foo };
}
declare const foo: number;
//#endregion
//#region tests/fixtures/source-map/index.d.ts
export declare const a: string;
export declare const b: string;
type Str = string;
export declare function fn(param: Str): string;
export interface Obj {
  nested: {
    key: string;
  };
  method(): void;
  'foo-bar': number;
}
export declare namespace Ns {
  type Str = string;
  type Foo<T> = T;
  type Obj = {
    id: string;
  };
}
//#endregion
export { mod_d_exports as Mod };
//# sourceMappingURL=index.d.ts.map
```

## index.d.ts.map

```map
{"version":3,"file":"index.d.ts","names":[],"sources":["../../fixtures/source-map/mod.ts","../../fixtures/source-map/index.ts"],"mappings":";;;cAAa;;;qBCAA;qBAEA;KAIR;wBACW,GAAG,OAAO;iBAIT;EACf;IACE;;EAEF;EACA;;yBAGe;OACH;OACA,IAAI,KAAK;OACT;IACV"}
```
