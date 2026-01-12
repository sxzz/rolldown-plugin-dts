## index.d.ts

```ts
//#region tests/fixtures/source-map/index.d.ts
declare const a: string;
declare const b: string;
type Str = string;
declare function fn(param: Str): string;
//#endregion
export { a, b, fn };
//# sourceMappingURL=index.d.ts.map
```

## index.d.ts.map

```map
{"version":3,"file":"index.d.ts","names":[],"sources":["../../fixtures/source-map/index.ts"],"mappings":";cAAa,CAAA;AAAA,cAEA,CAAA;AAAA,KAIR,GAAA;AAAA,iBACW,EAAA,CAAA,KAAA,EAAU,GAAA"}
```
