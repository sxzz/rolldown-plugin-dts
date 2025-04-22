// index.d.ts
//#region tests/rollup-plugin-dts/issue-106-inline-import-generic/options.d.ts
interface SimpleInterface {}
type ObjectWithParam<ParamObj> = {
  [Prop in keyof ParamObj]?: any;
};

//#endregion
//#region tests/rollup-plugin-dts/issue-106-inline-import-generic/index.d.ts
declare class CalendarDataManager {
  emitter: ObjectWithParam<SimpleInterface>;
}

//#endregion
export { CalendarDataManager };