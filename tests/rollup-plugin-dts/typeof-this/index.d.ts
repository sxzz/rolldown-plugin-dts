export class Test {
  functionOne(foo: string, bar: number): void
  functionTwo(...args: Parameters<typeof this.functionOne>): void
}
