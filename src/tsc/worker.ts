import process from 'node:process'
import { tscEmit, type TscOptions, type TscResult } from './index.ts'

export interface WorkerRequest {
  id: number
  options: TscOptions
}

export interface WorkerResponse {
  id: number
  result?: TscResult
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
