// index.d.ts

//#region tests/rollup-plugin-dts/ts42-abstract/index.d.ts
interface AbstractReturnValue {}
interface AbstractMember {}
declare abstract class AbstractClass {
  abstract someMethod(): AbstractReturnValue;
  badda(): void;
  member: AbstractMember;
}
type AbstractConstructor<T extends AbstractClass> = abstract new (...args: any[]) => T;

//#endregion
export { AbstractConstructor };