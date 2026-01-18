## index.d.ts

```ts
declare namespace mod_d_exports {
  export { foo };
}
declare const foo: number;
//#endregion
//#region tests/fixtures/source-map/index.d.ts
declare const a: string;
declare const b: string;
type Str = string;
declare function fn(param: Str): string;
interface Obj {
  nested: {
    key: string;
  };
  method(): void;
  'foo-bar': number;
}
declare namespace Ns {
  type Str = string;
  type Foo<T> = T;
  type Obj = {
    id: string;
  };
}
//#endregion
export { mod_d_exports as Mod, Ns, Obj, a, b, fn };
//# sourceMappingURL=index.d.ts.map
```

## index.d.ts.map

```map
{"version":3,"file":"index.d.ts","names":[],"sources":["../../fixtures/source-map/mod.ts","../../fixtures/source-map/index.ts"],"mappings":";;;cAAa,GAAA;;;cCAA,CAAA;AAAA,cAEA,CAAA;AAAA,KAIR,GAAA;AAAA,iBACW,EAAA,CAAG,KAAA,EAAO,GAAA;AAAA,UAIT,GAAA;EACf,MAAA;IACE,GAAA;EAAA;EAEF,MAAA;EACA,SAAA;AAAA;AAAA,kBAGe,EAAA;EAAA,KACH,GAAA;EAAA,KACA,GAAA,MAAS,CAAA;EAAA,KACT,GAAA;IACV,EAAA;EAAA;AAAA"}
```
