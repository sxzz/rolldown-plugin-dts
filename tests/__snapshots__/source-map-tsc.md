## source-map.d.ts

```ts
//#region tests/fixtures/source-map.d.ts
declare const a: string;
declare const b: string;
type Str = string;
declare function fn(param: Str): string;
//#endregion
export { a, b, fn };
//# sourceMappingURL=source-map.d.ts.map
```

## source-map.d.ts.map

```map
{"version":3,"file":"source-map.d.ts","names":[],"sources":["../../fixtures/source-map.ts"],"mappings":";cAAa,CAAA;AAAA,cAEA,CAAA;AAAA,KAIR,GAAA;AAAA,iBACW,EAAA,CAAA,KAAA,EAAU,GAAA"}
```
