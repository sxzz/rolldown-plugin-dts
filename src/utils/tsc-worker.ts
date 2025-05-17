import process from 'node:process'
import { createBirpc } from 'birpc'
import { tscEmit, type TscOptions, type TscResult } from './tsc.ts'
import type ts from 'typescript'

const functions: { emit: typeof emit } = { emit }
export type TscFunctions = typeof functions

const programs: ts.Program[] = []

createBirpc(functions, {
  post: (data) => process.send!(data),
  on: (fn) => process.on('message', fn),
})

function emit(options: Omit<TscOptions, 'programs'>): TscResult {
  return tscEmit({ ...options, programs })
}
