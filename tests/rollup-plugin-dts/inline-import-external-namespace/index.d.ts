export interface Foo {
  ns1: import("foo");
  ns2: typeof import("foo");
  ns3: import('foo_bar').T;
  ns4: import('foo-bar').T;
  ns5: import('foo.bar').T;
  ns6: import('foo/bar').T;
}
