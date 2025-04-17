// index.d.ts

//#region rolldown:runtime



//#endregion
//#region tests/rollup-plugin-dts/issue-217/example.d.ts

declare namespace example_d_exports {
  export { Example, dog, }
}
interface Example<S extends string> {
  example: S;
}
declare const dog: Example<"hi">;

//#endregion
export { example_d_exports as types };