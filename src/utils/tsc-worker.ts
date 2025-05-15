import { workerData, type MessagePort } from 'node:worker_threads'
import { createBirpc } from 'birpc'
import { tscEmit, type TscOptions, type TscResult } from './tsc.ts'
import type ts from 'typescript'

const functions: { emit: typeof emit } = { emit }
export type TscFunctions = typeof functions

const programs: ts.Program[] = []

const port: MessagePort = workerData.port
createBirpc(functions, {
  post: (data) => port.postMessage(data),
  on: (fn) => port.on('message', fn),
})

function emit(options: Omit<TscOptions, 'programs'>): TscResult {
  return tscEmit({ ...options, programs })
}
