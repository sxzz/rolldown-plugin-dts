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
//#region tests/fixtures/issue-217/example.d.ts
type example_d_exports = {}
__export(example_d_exports, {
	Example: () => Example,
	dog: () => dog
});
interface Example<S extends string> {
  example: S;
}
declare const dog: Example<"hi">;

//#endregion
export { example_d_exports as types };