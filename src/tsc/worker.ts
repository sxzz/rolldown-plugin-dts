import process from 'node:process'
import { tscEmit, type TscOptions, type TscResult } from './index.ts'

/**
 * A request sent to the worker process to emit TypeScript declarations for a
 * single module.
 */
export interface WorkerRequest {
  /**
   * Correlation ID used to match a {@linkcode WorkerResponse} back to the
   * request that produced it.
   */
  id: number

  /**
   * The {@linkcode TscOptions} describing the module to emit.
   */
  options: TscOptions
}

/**
 * A response sent back from the worker process after handling a
 * {@linkcode WorkerRequest}.
 */
export interface WorkerResponse {
  /**
   * The correlation ID of the originating {@linkcode WorkerRequest}.
   */
  id: number

  /**
   * The {@linkcode TscResult} produced on a successful emit.
   */
  result?: TscResult

  /**
   * The thrown value captured when the emit failed.
   */
  error?: unknown
}

process.on('message', (request: WorkerRequest) => {
  let response: WorkerResponse
  try {
    response = { id: request.id, result: tscEmit(request.options) }
  } catch (error) {
    response = {
      id: request.id,
      error,
    }
  }
  process.send!(response)
})
