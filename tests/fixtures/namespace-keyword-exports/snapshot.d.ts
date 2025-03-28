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
//#region tests/fixtures/namespace-keyword-exports/foo.d.ts
type foo_d_exports = {}
__export(foo_d_exports, { in: () => _in });
declare const _in = "foo";

//#endregion
export { foo_d_exports as foo };