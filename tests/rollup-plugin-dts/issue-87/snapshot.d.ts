// index.d.ts
export interface Cache {
  destroy: () => void;
}
export declare const uniqueId: (prefix?: string) => string;
export declare const Cache: () => Cache;
export interface Cache2 {
  add: (info: CacheInfo) => boolean;
  destroy: () => void;
}
export interface CacheInfo {
  id: number;
}
export declare const Cache2: () => Cache2;