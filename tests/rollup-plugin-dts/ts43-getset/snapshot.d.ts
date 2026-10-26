// index.d.ts
interface GetT {}
interface SetT {}
export interface Thing {
  get size(): GetT;
  set size(value: GetT | SetT | boolean);
}
export {};