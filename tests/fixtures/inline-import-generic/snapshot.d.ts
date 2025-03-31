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
//#region tests/fixtures/inline-import-generic/bar.d.ts
type bar_d_exports = {}
__export(bar_d_exports, { Bar: () => Bar });
interface Bar<T> {
  t: T;
}

//#endregion
//#region tests/fixtures/inline-import-generic/index.d.ts
interface Foo {
  bar: bar_d_exports.Bar<number>;
}

//#endregion
export { Foo };