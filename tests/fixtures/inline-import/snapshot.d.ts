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
//#region tests/fixtures/inline-import/bar.d.ts
type bar_d_exports = {}
__export(bar_d_exports, {
	Bar: () => Bar,
	Baz: () => Baz
});
interface Bar {}
declare const Baz = 123;

//#endregion
//#region tests/fixtures/inline-import/index.d.ts
interface Foo {
  bar: bar_d_exports.Bar;
  baz: typeof bar_d_exports.Baz;
}

//#endregion
export { Foo };