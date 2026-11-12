interface Foo {
  a: 1
}
const v = { a: 1 } as const

export default v as Foo
