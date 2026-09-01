// index.d.ts
//#region tests/rollup-plugin-dts/using-namespace-import-multiple/namespace.d.ts
interface Iface {}
declare abstract class Base {}
//#endregion
//#region tests/rollup-plugin-dts/using-namespace-import-multiple/index.d.ts
export declare class Klass extends Base implements Iface {}
//#endregion