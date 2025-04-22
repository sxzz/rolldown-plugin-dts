/**
 * named export
 */
export function fn() {
  return 42
}

/**
 * options
 */
export interface Options {
  /**
   * interface member
   */
  foo: string
}

/**
 * type alias
 */
export type Foo = string

/**
 * default export
 */
export default fn() as number
