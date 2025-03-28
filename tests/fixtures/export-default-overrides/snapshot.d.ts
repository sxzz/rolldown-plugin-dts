// index.d.ts

//#region tests/fixtures/export-default-overrides/index.d.ts
declare function autobind(): ClassDecorator | MethodDecorator;
type index_d_default = autobind
declare function autobind(constructor: Function): void;
type index_d_default = autobind
declare function autobind(prototype: Object, name: string, descriptor: PropertyDescriptor): PropertyDescriptor;
type index_d_default = autobind

//#endregion
export { index_d_default as default };