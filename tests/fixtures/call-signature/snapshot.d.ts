// index.d.ts

//#region tests/fixtures/call-signature/index.d.ts
interface I {
  (arg: string): string;
  staticProp: string;
}
declare const fn: {
  (arg: string): string;
  staticProp: string;
};

//#endregion
export { I, fn };