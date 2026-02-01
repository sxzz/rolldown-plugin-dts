// This mimics packages like 'postgres' that use export = namespace pattern
declare function mylib(): mylib.Client

declare namespace mylib {
  interface Client {
    query(sql: string): Promise<Row[]>
  }

  interface Row {
    [key: string]: unknown
  }

  interface Options {
    host: string
    port: number
  }
}

export = mylib
