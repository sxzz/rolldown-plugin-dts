// index.d.ts

//#region tests/fixtures/issue-106-inline-import-generic/index.d.ts
declare class CalendarDataManager {
  emitter: import("./options").ObjectWithParam<import("./options").SimpleInterface>;
}

//#endregion
export { CalendarDataManager };