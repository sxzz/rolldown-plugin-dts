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
{"version":3,"file":"basic.d.ts","names":["foo: number","arg0: SomeType<FooType>","opt: Interface","e: Enum"],"sources":["../../fixtures/basic.ts"],"sourcesContent":null,"mappings":";cAAaA;AAAb,KAEK,QAFQA,CAAAA,CAAAA,CAAAA,GAEM,CAFNA;AAAAA,KAGR,OAAA,GADA,MAAA;AAAc,UAET,SAAA,CADL,CAAA;AACK,iBAEM,EAAA,CAFN,IAAA,EAEe,QAFf,CAEwB,OAFxB,CAAA,EAAA,GAAA,EAEuC,SAFvC,CAAA,EAAA,IAAA;AAEM,aAEJ,IAAA;EAFI,CAAA,GAAA,CAAA;EAAA,CAAA,GAAA,CAAA;EAAkB,CAAA,GAAA,CAAA;;AAAe,cAQpC,GAAA,CARoC;EAEjD,GAAY,EAAA,MAAA;EAMZ,EAAA,CAAa,CAAA,EAEL,IAFK,CAAA,EAAA,IAAA"}
```