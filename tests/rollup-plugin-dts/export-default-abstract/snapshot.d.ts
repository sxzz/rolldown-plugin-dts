// index.d.ts
interface MemberTypes {}
interface TypeInfo {}
export default abstract class MemberInfo {
  abstract readonly name: string;
  abstract readonly declaringType: TypeInfo;
  abstract readonly memberType: MemberTypes;
}
export {};