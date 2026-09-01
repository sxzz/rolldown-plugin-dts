// index.d.ts
//#region tests/rollup-plugin-dts/generic-shadowing/mod.d.ts
export type Config1<Client> = Client;
//#endregion
//#region tests/rollup-plugin-dts/generic-shadowing/index.d.ts
export type Client = any;
export type Config2<Client> = Client;
//#endregion