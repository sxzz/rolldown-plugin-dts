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
//#region tests/rollup-plugin-dts/re-export-namespace/namespace.d.ts
type namespace_d_exports = {}
__export(namespace_d_exports, {
	A: () => A,
	B: () => B,
	C: () => C,
	D: () => D,
	E: () => E,
	F: () => F,
	GenericC: () => GenericC,
	GenericF: () => GenericF,
	GenericI: () => GenericI,
	GenericT: () => GenericT
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
declare class GenericC<T1, T2> {}
declare function GenericF<T1, T2>(): void;
interface GenericI<T1, T2> {}
declare type GenericT<T1, T2> = GenericI<T1, T2>;

//#endregion
export { namespace_d_exports as ns1, namespace_d_exports as ns2 };