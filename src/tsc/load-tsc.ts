import { createRequire } from 'node:module'
import { createDebug } from 'obug'

const require = createRequire(import.meta.url)
const debug = createDebug('rolldown-plugin-dts:load-tsc')
let _ts: typeof import('typescript') | undefined

export function requireTS(message: string = ''): typeof import('typescript') {
  if (_ts) return _ts

  try {
    _ts = require('typescript')
    if (debug.enabled) {
      debug(
        `loaded TypeScript version ${_ts!.version} from ${require.resolve('typescript')}`,
      )
    }

    return _ts as any
    // eslint-disable-next-line unicorn/catch-error-name
  } catch (cause) {
    throw new Error(
      `TypeScript is not installed. You should install \`typescript\` package. ${
        message
      }`,
      { cause },
    )
  }
}
