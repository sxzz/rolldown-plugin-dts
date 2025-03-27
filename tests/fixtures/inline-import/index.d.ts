export interface Foo {
  bar: import('./mod').Foo
  baz: typeof import('./mod').Bar
}
