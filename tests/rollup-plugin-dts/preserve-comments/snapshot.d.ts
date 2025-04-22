// index.d.ts
//#region tests/rollup-plugin-dts/preserve-comments/first.d.ts
/**
* A function with doc-comment that is imported first
*/
declare function first(): void;

//#endregion
//#region tests/rollup-plugin-dts/preserve-comments/second.d.ts
/**
* A function with doc-comment that is imported second
*/
declare function second(): void;

//#endregion
//#region tests/rollup-plugin-dts/preserve-comments/index.d.ts
/**
* A function with doc-comment in the main file
*/
declare function main(): void;

//#endregion
export { first, main, second };