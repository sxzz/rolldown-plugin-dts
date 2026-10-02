import type { Response } from './typed-response'

export interface Options {
  /** Bring your own implementation */
  Response?: typeof Response
  prototype?: typeof Response.prototype
}

export declare function request<T>(
  url: string,
  options?: Options,
): Promise<Response<T>>
