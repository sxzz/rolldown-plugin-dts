// index.d.ts
//#region tests/rollup-plugin-dts/preserve-comments/first.d.ts
/**
 * A function with doc-comment that is imported first
 */
export declare function first(): void;
//#endregion
//#region tests/rollup-plugin-dts/preserve-comments/second.d.ts
/**
 * A function with doc-comment that is imported second
 */
export declare function second(): void;
//#endregion
//#region tests/rollup-plugin-dts/preserve-comments/index.d.ts
/**
 * A function with doc-comment in the main file
 */
export declare function main(): void;
//#endregion