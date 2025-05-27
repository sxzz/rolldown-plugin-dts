## basic.d.ts

```ts
//#region tests/fixtures/basic.d.ts
declare const foo: number;
type SomeType<T> = T;
type FooType = string;
interface Interface {}
declare function fn(arg0: SomeType<FooType>, opt: Interface): void;
declare enum Enum {
  A = 0,
  B = 1,
  C = 2,
}
declare class Cls {
  foo: string;
  fn(e: Enum): void;
}
//#endregion
export { Cls, Enum, fn, foo };
//# sourceMappingURL=basic.d.ts.map
```
## basic.d.ts.map

```map
{"version":3,"file":"basic.d.ts","names":[],"sources":["../../fixtures/basic.ts"],"sourcesContent":[],"mappings":";cAAa;AAAb,KAEK,QAFwB,CAAA,CAAA,CAAA,GAEV,CAFU;AAAA,KAGxB,OAAA,GADQ,MAAA;AAAO,UAEV,SAAA,CADE,CAAA;AAGI,iBAAA,EAAA,CAAE,IAAA,EAAO,QAAP,CAAgB,OAAhB,CAAA,EAAA,GAAA,EAA+B,SAA/B,CAAA,EAAA,IAAA;AAAA,aAEN,IAAA;EAFM,CAAA,GAAgB,CAAA;EAAO,CAAA,GAAhB,CAAA;EAAQ,CAAA,GAAgB,CAAA;AAAS;AAE9C,cAMC,GAAA,CANG;EAMH,GAAA,EAAA,MAAG;QAER"}
```