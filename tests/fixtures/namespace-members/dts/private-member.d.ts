import { Timeout as OptsTimeout } from './options'

export declare namespace Config {
  type Timeout = OptsTimeout
  export interface Limits {
    timeout: Timeout
  }
  export {}
}
