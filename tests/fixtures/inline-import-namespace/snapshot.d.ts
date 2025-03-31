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
//#region tests/fixtures/inline-import-namespace/bar.d.ts
type bar_d_exports = {}
__export(bar_d_exports, {
	Bar: () => Bar,
	IBar: () => IBar
});
declare class Bar {}
interface IBar {}

//#endregion
//#region tests/fixtures/inline-import-namespace/index.d.ts
interface Foo {
  ns: typeof bar_d_exports;
}

//#endregion
export { Foo };