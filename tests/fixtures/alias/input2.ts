import { Shared, shared } from './shared'

export interface Input2 extends Shared {
  input2: string
}

export const input2: Input2 = {
  ...shared,
  input2: 'input2',
}
