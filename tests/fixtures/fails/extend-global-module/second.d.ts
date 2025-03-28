export interface Second {}

declare global {
  namespace NodeJS {
    interface Global {
      second: Second;
    }
  }
}
