// index.d.ts
//#region tests/rollup-plugin-dts/generic-shadowing/mod.d.ts
type Config1<Client$1> = Client$1;
//#endregion
//#region tests/rollup-plugin-dts/generic-shadowing/index.d.ts
type Client = any;
type Config2<Client$1> = Client$1;
//#endregion
export { Client, Config1, Config2 };