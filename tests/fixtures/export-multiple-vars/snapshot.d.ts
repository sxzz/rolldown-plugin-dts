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
//#region tests/fixtures/export-multiple-vars/settings.d.ts
type settings_d_exports = {}
__export(settings_d_exports, {
	In: () => In,
	Out: () => Out
});
declare type In = { a: string };
declare type Out = { b: number };

//#endregion
//#region tests/fixtures/export-multiple-vars/util.d.ts
declare const config: {
  normalize: (inVar: settings_d_exports.In) => settings_d_exports.Out;
};
declare const options: {
  normalize: (inVar: settings_d_exports.In) => settings_d_exports.Out;
};
declare const params: {
  normalize: (inVar: settings_d_exports.In) => settings_d_exports.Out;
};

//#endregion
export { In, Out, config, options, params };