import { createRequire } from 'node:module'
import { createDebug } from 'obug'

const nodeRequire: NodeJS.Require = createRequire(import.meta.url)
let requireImpl: NodeJS.Require = nodeRequire

// In test builds `require` is a stable wrapper whose implementation can be
// swapped via `mockRequire`; production uses the real require directly.
export const require: NodeJS.Require = import.meta.TEST
  ? (Object.assign((id: string) => requireImpl(id), {
      resolve: (id: string, options?: { paths?: string[] }) =>
        requireImpl.resolve(id, options),
    }) as NodeJS.Require)
  : nodeRequire

const debug = createDebug('rolldown-plugin-dts:utils')

function tryRequire<T>(moduleName: string): T | undefined {
  try {
    return require(moduleName)
  } catch {}
}

export function tryResolve(id: string): string | undefined {
  try {
    return require.resolve(id)
  } catch {}
}

let _ts: typeof import('typescript') | undefined

export function isTS70Installed(): boolean {
  const tsPkg = tryRequire<{ version: string }>('typescript/package.json')
  return tsPkg?.version.slice(0, 3) === '7.0'
}

export function requireTSApi(
  mode: string = 'tsc',
  message: string = '.',
): typeof import('typescript') {
  if (_ts) return _ts

  if (isTS70Installed()) {
    throw new Error(
      `TypeScript 7.0 is not supported when using ${mode}. Please use TypeScript 6.0 or below${message}`,
    )
  }

  let ts: typeof import('typescript')
  try {
    ts = require('typescript')
    // eslint-disable-next-line unicorn/catch-error-name
  } catch (cause) {
    throw new Error(
      `TypeScript is not installed. Please install the \`typescript\` package (v7.0 is not yet supported)${
        message
      }`,
      { cause },
    )
  }

  if (debug.enabled) {
    debug(
      `Loaded TypeScript version ${ts.version} from ${require.resolve('typescript')}`,
    )
  }

  return (_ts = ts)
}

// Test-only hook: swaps the underlying `require` implementation (pass nothing
// to restore the real one) and clears the cached TypeScript API.
export function mockRequire(mock?: NodeJS.Require): void {
  requireImpl = mock ?? nodeRequire
  _ts = undefined
}
