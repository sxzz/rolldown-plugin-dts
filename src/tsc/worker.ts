import process from 'node:process'
import { createBirpc } from 'birpc'
import {
  globalContext,
  invalidateContextFile,
  resetContext,
} from './context.ts'
import { tscEmit } from './index.ts'

function invalidate(file: string): void {
  invalidateContextFile(globalContext, file)
}

function reset(): void {
  resetContext(globalContext)
}

interface Functions {
  tscEmit: typeof tscEmit
  invalidate: typeof invalidate
  reset: typeof reset
}

const functions: Functions = { tscEmit, invalidate, reset }
export type TscFunctions = Functions

createBirpc(functions, {
  post: (data) => process.send!(data),
  on: (fn) => process.on('message', fn),
})
