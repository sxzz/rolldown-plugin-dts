import * as Opts from './options'
import type { Socket as NetSocket } from 'external-net'
import type { Timeout as OptsTimeout } from './options'

export class Client {}

export declare namespace Client {
  /** reached through a renamed import of an external module */
  export type Socket = NetSocket
  /** reached through a renamed import */
  export type Timeout = OptsTimeout
  /** reached through a namespace import */
  export type RequestOptions = Opts.RequestOptions
  export import Page = Opts.Page

  // refers to the member above, and has to keep doing so
  export type Retry = { timeout: Timeout }
}
