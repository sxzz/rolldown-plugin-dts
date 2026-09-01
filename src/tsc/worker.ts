import process from 'node:process'
import { LanguageContext } from '../custom-language.ts'
import { createVueLanguage, type VueLanguageOptions } from './vue.ts'
import { tscEmit, type TscOptions, type TscResult } from './index.ts'

export type WorkerTscOptions = Omit<TscOptions, 'context' | 'languageContext'>

export interface WorkerRequest {
  id: number
  options: WorkerTscOptions
  vue?: VueLanguageOptions
}

export interface WorkerResponse {
  id: number
  result?: TscResult
  error?: unknown
}

let languageContext: LanguageContext | undefined

process.on('message', (request: WorkerRequest) => {
  let response: WorkerResponse
  try {
    languageContext ||= new LanguageContext(
      request.vue ? [createVueLanguage(request.vue)] : [],
    )
    const options: TscOptions = {
      ...request.options,
      languageContext,
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
