import type { Connection, Row, Options, DatabaseError } from 'mock-db'

export interface DbConfig {
  connection: Connection
  options?: Options
}

export function runQuery(conn: Connection, sql: string): Promise<Row[]> {
  return conn.query(sql)
}

export class Database {
  private conn: Connection
  private lastError?: DatabaseError

  constructor(conn: Connection) {
    this.conn = conn
  }

  getConnection(): Connection {
    return this.conn
  }

  getLastError(): DatabaseError | undefined {
    return this.lastError
  }
}

export type QueryResult = Row[]

export type IsError<T> = T extends DatabaseError ? true : false
