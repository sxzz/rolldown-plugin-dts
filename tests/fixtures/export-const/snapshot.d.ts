// index.d.ts

//#region tests/fixtures/export-const/index.d.ts
declare const strRuntime = 'hello'
declare const stringType: string
declare const strLiteralType: 'world'
declare const numberRuntime = 42
declare const numberLiteralType: 42
declare const numberType: number
declare const arrType: never[]
declare const arrType2: Array<string>
declare const tuple: [number, string]
declare const symbol: unique symbol

//#endregion
export { arrType, arrType2, numberLiteralType, numberRuntime, numberType, strLiteralType, strRuntime, stringType, symbol, tuple };