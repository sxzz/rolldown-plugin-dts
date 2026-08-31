import process from 'node:process'
import { LanguageContext } from '../custom-language.ts'
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
    const options: TscOptions = {
      ...request.options,
      // Structured clone preserves the data but not the class prototype.
      languageContext: new LanguageContext(
        request.options.languageContext.languages,
      ),
    }
    response = { id: request.id, result: tscEmit(options) }
  } catch (error) {
    response = {
      id: request.id,
      error,
    }
  }
  process.send!(response)
})
