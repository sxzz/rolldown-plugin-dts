import process from 'node:process'
import { createBirpc } from 'birpc'
import { tscEmit } from './tsc.ts'

const functions: { tscEmit: typeof tscEmit } = { tscEmit }
export type TscFunctions = typeof functions

createBirpc(functions, {
  post: (data) => process.send!(data),
  on: (fn) => process.on('message', fn),
})
