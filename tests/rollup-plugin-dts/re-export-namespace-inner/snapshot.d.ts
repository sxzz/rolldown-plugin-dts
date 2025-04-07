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
//#region tests/rollup-plugin-dts/re-export-namespace-inner/mod.d.ts
type mod_d_exports = {}
__export(mod_d_exports, { inner: () => inner });
declare namespace inner {
  type Ty = number;
  const num: number;
}

//#endregion
export { mod_d_exports as outer };