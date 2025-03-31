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
//#region tests/fixtures/issue-106-inline-import-generic/options.d.ts
type options_d_exports = {}
__export(options_d_exports, {
	ObjectWithParam: () => ObjectWithParam,
	SimpleInterface: () => SimpleInterface
});
interface SimpleInterface {}
type ObjectWithParam<ParamObj> = {
  [Prop in keyof ParamObj]?: any;
};

//#endregion
//#region tests/fixtures/issue-106-inline-import-generic/index.d.ts
declare class CalendarDataManager {
  emitter: options_d_exports.ObjectWithParam<options_d_exports.SimpleInterface>;
}

//#endregion
export { CalendarDataManager };