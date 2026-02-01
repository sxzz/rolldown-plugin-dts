export interface Sql {
  query(sql: string): Promise<unknown[]>
}
