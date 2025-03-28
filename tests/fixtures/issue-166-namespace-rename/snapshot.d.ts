// index.d.ts

//#region tests/fixtures/issue-166-namespace-rename/a.d.ts
declare namespace A {
  export { Item };
}

//#endregion
//#region tests/fixtures/issue-166-namespace-rename/b.d.ts
declare namespace B {
  export { Item };
}

//#endregion
export { A, B };