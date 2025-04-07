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
//#region tests/rollup-plugin-dts/issue-185-hoist-generic-extends/a.d.ts
type a_d_exports = {}
__export(a_d_exports, {
	Props: () => Props,
	System: () => System
});
declare type Props = Record<string, number>;
declare class System<T extends Props> {
  _obj: T;
  constructor(src: T);
}

//#endregion
export { a_d_exports as A };