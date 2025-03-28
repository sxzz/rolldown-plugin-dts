// index.d.ts

//#region tests/fixtures/export-default-abstract/memberTypes.d.ts
interface MemberTypes {}
type memberTypes_d_default = MemberTypes

//#endregion
//#region tests/fixtures/export-default-abstract/typeInfo.d.ts
interface TypeInfo {}
type typeInfo_d_default = TypeInfo

//#endregion
//#region tests/fixtures/export-default-abstract/index.d.ts
declare abstract class MemberInfo {
  abstract readonly name: string;
  abstract readonly declaringType: typeInfo_d_default;
  abstract readonly memberType: memberTypes_d_default;
}
type index_d_default = MemberInfo

//#endregion
export { index_d_default as default };