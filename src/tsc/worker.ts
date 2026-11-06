import process from 'node:process'
import { LanguageContext } from '../custom-language.ts'
import { createVueLanguage, type VueLanguageOptions } from './vue.ts'
import {
  tscCheck,
  tscEmit,
  type TscCheckOptions,
  type TscOptions,
  type TscResult,
} from './index.ts'

export type WorkerTscOptions = Omit<TscOptions, 'context' | 'languageContext'>
export type WorkerTscCheckOptions = Omit<
  TscCheckOptions,
  'context' | 'languageContext'
>

export type WorkerRequest = {
  id: number
  vue?: VueLanguageOptions
} & (
  | { type: 'emit'; options: WorkerTscOptions }
  | { type: 'check'; options: WorkerTscCheckOptions }
)

export interface WorkerResponse {
  id: number
  result?: TscResult | string
  error?: unknown
}

let languageContext: LanguageContext | undefined

process.on('message', (request: WorkerRequest) => {
  let response: WorkerResponse
  try {
    languageContext ||= new LanguageContext(
      request.vue ? [createVueLanguage(request.vue)] : [],
    )
    const result =
      request.type === 'check'
        ? tscCheck({ ...request.options, languageContext })
        : tscEmit({ ...request.options, languageContext })
    response = { id: request.id, result }
  } catch (error) {
    response = {
      id: request.id,
      error,
    }
  }
  process.send!(response)
})
