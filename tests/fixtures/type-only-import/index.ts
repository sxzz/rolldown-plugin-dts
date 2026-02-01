// Test: import type with type keyword outside the braces
import type { Sql } from './types'

export function runQuery(client: Sql): Promise<unknown[]> {
  return client.query('SELECT 1')
}
