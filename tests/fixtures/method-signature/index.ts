import * as mod from './mod'

export interface Test {
  [mod.a]: string
  [mod.b](): string
  get [mod.c](): string
}
