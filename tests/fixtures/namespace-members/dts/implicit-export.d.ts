import { Timeout as OptsTimeout } from './options'

export declare namespace Config {
  type Timeout = OptsTimeout
  interface Limits {
    timeout: Timeout
  }
  const version: string
  import Alias = Config.Limits
}
