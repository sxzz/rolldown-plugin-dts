export const str = 'foo'
export const num = 42
export const bool = true

export function fn(arg: typeof str) {
  if (false) {
    return 'foo'
  }
  return 1
}
