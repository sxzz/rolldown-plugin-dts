// index.d.ts

//#region tests/fixtures/issue-106-inline-import-generic/options.d.ts
interface SimpleInterface {}
type ObjectWithParam<ParamObj> = {
  [Prop in keyof ParamObj]?: any;
};

//#endregion
//#region tests/fixtures/issue-106-inline-import-generic/index.d.ts
declare class CalendarDataManager {
  emitter: ObjectWithParam<SimpleInterface>;
}

//#endregion
export { CalendarDataManager };