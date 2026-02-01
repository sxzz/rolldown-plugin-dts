// Import types from a module that uses export = namespace pattern
import type { Client, Row } from './lib'

export class Database {
  private client: Client

  constructor(client: Client) {
    this.client = client
  }

  async query(sql: string): Promise<Row[]> {
    return this.client.query(sql)
  }
}
