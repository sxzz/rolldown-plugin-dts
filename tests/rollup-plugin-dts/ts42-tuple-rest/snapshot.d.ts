// index.d.ts

//#region tests/rollup-plugin-dts/ts42-tuple-rest/index.d.ts
interface Leading {}
interface Middle {}
type UsesLeading = [...Array<Leading>, number];
type UsesMiddle = [boolean, ...Array<Middle>, boolean];

//#endregion
export { UsesLeading, UsesMiddle };