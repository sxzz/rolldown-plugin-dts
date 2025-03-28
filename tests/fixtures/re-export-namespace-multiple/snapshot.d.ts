// index.d.ts

//#region rolldown:runtime
type __defProp = Object.defineProperty
type __export = (target, all) => {
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
}

//#endregion
//#region tests/fixtures/re-export-namespace-multiple/defs.d.ts
type defs_d_exports = {}
__export(defs_d_exports, {
	A: () => A,
	B: () => B,
	C: () => C,
	D: () => D,
	E: () => E,
	F: () => F
});
interface A {}
declare function B(): void;
declare class C {}
declare enum D {
  A = 0,
  B = 1,
}
declare const E: string;
declare type F = string;

//#endregion
//#region tests/fixtures/re-export-namespace-multiple/deep.d.ts
type deep_d_exports = {}
__export(deep_d_exports, { ns: () => defs_d_exports });

//#endregion
//#region tests/fixtures/re-export-namespace-multiple/only-one.d.ts
type only_one_d_exports = {}
__export(only_one_d_exports, { A: () => A });

//#endregion
//#region tests/fixtures/re-export-namespace-multiple/index.d.ts
interface WithA {
  a: A;
}

//#endregion
export { WithA, deep_d_exports as deep, defs_d_exports as ns, only_one_d_exports as onlyOne };