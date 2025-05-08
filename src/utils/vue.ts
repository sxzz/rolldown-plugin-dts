import { proxyCreateProgram } from '@volar/typescript'
import * as vue from '@vue/language-core'
import Debug from 'debug'
import { ts } from './tsc.ts'
import type Ts from 'typescript'

const debug = Debug('rolldown-plugin-dts:vue')

let createVueProgram: typeof Ts.createProgram

// credits: https://github.com/vuejs/language-tools/blob/25f40ead59d862b3bd7011f2dd2968f47dfcf629/packages/tsc/index.ts
export function createVueProgramFactory(): typeof Ts.createProgram {
  if (createVueProgram) return createVueProgram

  debug('loading vue language tools')
  return (createVueProgram = proxyCreateProgram(
    ts,
    ts.createProgram,
    (ts, options) => {
      const { configFilePath } = options.options
      const vueOptions =
        typeof configFilePath === 'string'
          ? vue.createParsedCommandLine(
              ts,
              ts.sys,
              configFilePath.replaceAll('\\', '/'),
            ).vueOptions
          : vue.getDefaultCompilerOptions()
      const vueLanguagePlugin = vue.createVueLanguagePlugin<string>(
        ts,
        options.options,
        vueOptions,
        (id) => id,
      )
      return { languagePlugins: [vueLanguagePlugin] }
    },
  ))
}
