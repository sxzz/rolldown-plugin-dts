// index.d.ts

//#region tests/fixtures/preserve-comments/first.d.ts
/**
 * A function with doc-comment that is imported first
 */
declare function first(): void;

//#endregion
//#region tests/fixtures/preserve-comments/second.d.ts
/**
 * A function with doc-comment that is imported second
 */
declare function second(): void;

//#endregion
//#region tests/fixtures/preserve-comments/index.d.ts
/**
 * A function with doc-comment in the main file
 */
declare function main(): void;

//#endregion
export { first, main, second };