// index.d.ts
declare namespace mod_d_exports {
  export { inner };
}
declare namespace inner {
  type Ty = number;
  const num: number;
}

//#endregion
export { mod_d_exports as outer };