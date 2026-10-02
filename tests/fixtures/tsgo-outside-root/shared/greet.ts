export interface Greeting {
  message: string
}

export function greet(name: string): Greeting {
  return { message: `hi ${name}` }
}
