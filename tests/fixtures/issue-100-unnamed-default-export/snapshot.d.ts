// index.d.ts

//#region tests/fixtures/issue-100-unnamed-default-export/index.d.ts
/**
* @description @TODO
*/
declare function export_default <T extends object>(
  object: T,
  initializationObject: {
    [x in keyof T]: () => Promise<T[x]>;
  },
): Promise<void>;
type index_d_default = export_default

//#endregion
export { index_d_default as default };