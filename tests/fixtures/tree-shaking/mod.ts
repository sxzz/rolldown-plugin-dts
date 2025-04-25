import * as http from 'node:http'

export function foo(): typeof http {
  return http
}

export type A = string
