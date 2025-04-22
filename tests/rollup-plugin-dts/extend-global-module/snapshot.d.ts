// index.d.ts
//#region tests/rollup-plugin-dts/extend-global-module/second.d.ts
interface Second$2 {}
declare global {
  namespace NodeJS {
    interface Global {
      second: Second$2;
    }
  }
}

//#endregion
//#region tests/rollup-plugin-dts/extend-global-module/second2.d.ts
interface Second$1 {}
declare global {
  namespace NodeJS {
    interface Global {
      second2: Second$1;
    }
  }
}

//#endregion
//#region tests/rollup-plugin-dts/extend-global-module/second3.d.ts
interface Second {}
declare module "foobar" {
  const second3: Second;
}

//#endregion
//#region tests/rollup-plugin-dts/extend-global-module/index.d.ts
interface First {}
declare global {
  namespace NodeJS {
    interface Global {
      first: First;
    }
  }
}
declare const e: any;

//#endregion
export { e as default };