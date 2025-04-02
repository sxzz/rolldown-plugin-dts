// index.d.ts

//#region tests/fixtures/export-default-abstract/memberTypes.d.ts
interface MemberTypes {}

//#endregion
//#region tests/fixtures/export-default-abstract/typeInfo.d.ts
interface TypeInfo {}

//#endregion
//#region tests/fixtures/export-default-abstract/index.d.ts
declare abstract class MemberInfo {
  abstract readonly name: string;
  abstract readonly declaringType: TypeInfo;
  abstract readonly memberType: MemberTypes;
}

//#endregion
export { MemberInfo as default };