export interface Response<T> extends globalThis.Response {
  json(): Promise<T>
}
export interface Options {
  Response?: typeof Response
}
export declare function request<T>(
  url: string,
  options?: Options,
): Promise<Response<T>>
