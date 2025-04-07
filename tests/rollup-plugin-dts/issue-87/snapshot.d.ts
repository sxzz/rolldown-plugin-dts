// index.d.ts

//#region tests/rollup-plugin-dts/issue-87/a.d.ts
interface Cache {
  destroy: () => void;
}
declare const uniqueId: (prefix?: string) => string;
declare const Cache: () => Cache;

//#endregion
//#region tests/rollup-plugin-dts/issue-87/b.d.ts
interface Cache2 {
  add: (info: CacheInfo) => boolean;
  destroy: () => void;
}
interface CacheInfo {
  id: number;
}
declare const Cache2: () => Cache2;

//#endregion
export { Cache, Cache2, CacheInfo, uniqueId };