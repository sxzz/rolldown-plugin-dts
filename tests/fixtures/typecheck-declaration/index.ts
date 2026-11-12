// Type-checks, but declarations cannot express the private member (TS4094).
export const Counter = class {
  private count = 0
}
