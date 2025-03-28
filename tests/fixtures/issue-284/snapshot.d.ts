// index.d.ts

//#region tests/fixtures/issue-284/index.d.ts
interface MyInterface {
  a: string;
}
declare namespace MyInterface {
  export const b: string;
}

//#endregion
export { MyInterface };