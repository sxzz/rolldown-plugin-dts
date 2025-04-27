// index.d.ts
//#region tests/rollup-plugin-dts/overrides-with-rename/b.d.ts

declare function autobind$1(): typeof autobind;
declare function autobind$1(constructor: Function): void;
declare function autobind$1(prototype: typeof autobind, name: string, descriptor: PropertyDescriptor): PropertyDescriptor;

//#endregion
//#region tests/rollup-plugin-dts/overrides-with-rename/a.d.ts
declare function autobind(): typeof autobind$1;
declare function autobind(constructor: Function): void;
declare function autobind(prototype: typeof autobind$1, name: string, descriptor: PropertyDescriptor): PropertyDescriptor;

//#endregion
export { autobind as A, autobind$1 as B };