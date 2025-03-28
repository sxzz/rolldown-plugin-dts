// index.d.ts

//#region tests/fixtures/preserve-comments/first.d.ts
declare function first(): void;

//#endregion
//#region tests/fixtures/preserve-comments/second.d.ts
declare function second(): void;

//#endregion
//#region tests/fixtures/preserve-comments/index.d.ts
declare function main(): void;

//#endregion
export { first, main, second };