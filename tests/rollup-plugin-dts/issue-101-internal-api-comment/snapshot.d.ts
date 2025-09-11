// index.d.ts
//#region tests/rollup-plugin-dts/issue-101-internal-api-comment/api.d.ts
/**
 * JSDoc for public_api_with_jsdoc
 */
declare function public_api_with_jsdoc(): void;
declare function public_api_without_jsdoc(): void;
//#endregion
//#region tests/rollup-plugin-dts/issue-101-internal-api-comment/index.d.ts
/** JSDoc for public_type */
type public_type = number;
//#endregion
export { public_api_with_jsdoc, public_api_without_jsdoc, public_type };