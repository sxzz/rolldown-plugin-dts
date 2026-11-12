// index.d.ts
interface SimpleInterface {}
type ObjectWithParam<ParamObj> = { [Prop in keyof ParamObj]?: any; };
export declare class CalendarDataManager {
  emitter: ObjectWithParam<SimpleInterface>;
}
export {};