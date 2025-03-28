// index.d.ts

//#region tests/fixtures/ts43-getset/foo.d.ts
interface GetT {}
interface SetT {}

//#endregion
//#region tests/fixtures/ts43-getset/index.d.ts
interface Thing {
  get size(): GetT;
  set size(value: GetT | SetT | boolean);
}

//#endregion
export { Thing };