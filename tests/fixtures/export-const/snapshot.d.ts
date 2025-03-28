// index.d.ts

//#region tests/fixtures/export-const/index.d.ts
declare const sLit = "";
declare const nLit = 0;
declare const aLit: never[];
declare const sLitDef: "";
declare const nLitDef: 0;
declare const sDef: string;
declare const nDef: number;
declare const aDef: Array<number>;
declare const tuple: [number, string];
declare const unique: unique symbol;

//#endregion
export { aDef, aLit, nDef, nLit, nLitDef, sDef, sLit, sLitDef, tuple, unique };