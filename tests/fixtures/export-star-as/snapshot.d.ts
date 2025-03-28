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
//#region tests/fixtures/export-star-as/foo.d.ts
type foo_d_exports = {}
__export(foo_d_exports, { A: () => A });
interface A {}

//#endregion
export { foo_d_exports as foo };