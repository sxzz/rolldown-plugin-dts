import { createRequire } from 'node:module'
import type Ts from 'typescript'

const require = createRequire(import.meta.url)
export const ts: typeof import('typescript') = require('typescript')

export type { Ts }
