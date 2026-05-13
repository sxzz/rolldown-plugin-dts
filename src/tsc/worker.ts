import process from 'node:process'
import { createBirpc } from 'birpc'
import { tscEmit } from './index.ts'
import type { TscOptions } from '../options.ts'

/**
 * The function table passed to {@linkcode createBirpc} on the worker side.
 * Exposes {@linkcode tscEmit} so it can be invoked by the main process over
 * Node.js IPC when {@linkcode TscOptions.parallel | parallel} mode is active.
 */
const functions: { tscEmit: typeof tscEmit } = { tscEmit }

/**
 * The RPC interface exposed by the worker process when
 * {@linkcode TscOptions.parallel | parallel} mode is
 * enabled. Mirrors {@linkcode tscEmit} so the main process can invoke it over
 * Node.js IPC via `birpc`.
 */
export type TscFunctions = typeof functions

createBirpc(functions, {
  post: (data) => process.send!(data),
  on: (fn) => process.on('message', fn),
})
