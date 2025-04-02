// index.d.ts

//#region tests/fixtures/unnamed-default-export-without-space/index.d.ts
/**
* @description @TODO
*/
/**
 * @description @TODO
 */
declare function export_default<T extends object>(
  object: T,
  initializationObject: {
    [x in keyof T]: () => Promise<T[x]>;
  },
): Promise<void>;

//#endregion
export { export_default as default };