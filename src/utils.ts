export function requireTS(message: string): typeof import('typescript') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('typescript')
  } catch {
    throw new Error(message)
  }
}
