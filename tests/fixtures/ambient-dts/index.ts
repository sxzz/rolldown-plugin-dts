import type {
  PublicApi,
  AmbientConnection,
  AmbientConfig,
  AmbientDatabase,
} from 'ambient-lib'

export interface MyService {
  api: PublicApi
  connection: AmbientConnection
  config: AmbientConfig
  db: AmbientDatabase
}

export declare function connect(config: AmbientConfig): AmbientConnection
