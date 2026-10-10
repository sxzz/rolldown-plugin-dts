import { greet, type Greeting } from '../shared/greet.ts'

export function hello(name: string): Greeting {
  return greet(name)
}
