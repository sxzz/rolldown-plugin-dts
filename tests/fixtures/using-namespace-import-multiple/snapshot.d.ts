// index.d.ts

//#region tests/fixtures/using-namespace-import-multiple/namespace.d.ts
interface Iface {}
declare abstract class Base {}

//#endregion
//#region tests/fixtures/using-namespace-import-multiple/index.d.ts
declare class Klass extends Base implements Iface {}

//#endregion
export { Klass };