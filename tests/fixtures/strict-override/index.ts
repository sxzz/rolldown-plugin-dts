export function f(x?: string) {
  return x ?? null
}
export const g = (n: number) => (n > 0 ? 'pos' : undefined)
