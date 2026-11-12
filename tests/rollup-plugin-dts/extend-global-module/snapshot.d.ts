// index.d.ts
interface Second$2 {}
declare global {
  namespace NodeJS {
    interface Global {
      second: Second$2;
    }
  }
}
interface Second$1 {}
declare global {
  namespace NodeJS {
    interface Global {
      second2: Second$1;
    }
  }
}
interface Second {}
declare module "foobar" {
  const second3: Second;
}
interface First {}
declare global {
  namespace NodeJS {
    interface Global {
      first: First;
    }
  }
}
declare const e: any;
export { e as default };