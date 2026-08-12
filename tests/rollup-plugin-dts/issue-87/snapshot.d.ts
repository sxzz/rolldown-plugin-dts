// index.d.ts
//#region tests/rollup-plugin-dts/issue-87/a.d.ts
export interface Cache {
  destroy: () => void;
}
export declare const uniqueId: (prefix?: string) => string;
export declare const Cache: () => Cache;
//#endregion
//#region tests/rollup-plugin-dts/issue-87/b.d.ts
export interface Cache2 {
  add: (info: CacheInfo) => boolean;
  destroy: () => void;
}
export interface CacheInfo {
  id: number;
}
export declare const Cache2: () => Cache2;
//#endregion