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

export function tryRequire<T>(moduleName: string): T | undefined {
  try {
    return require(moduleName)
  } catch {}
}

export function tryResolve(
  id: string,
  options?: { paths?: string[] },
): string | undefined {
  try {
    return require.resolve(id, options)
  } catch {}
}

let _ts: typeof import('typescript') | undefined

export interface PackageInfo {
  name: string
  version: string
  packageJsonPath: string
}

export function getPackageInfo(name: string): PackageInfo | undefined {
  const packageJsonPath = tryResolve(`${name}/package.json`)
  if (!packageJsonPath) return

  const pkg = tryRequire<{ version?: string }>(packageJsonPath)
  if (!pkg?.version) return

  return { name, version: pkg.version, packageJsonPath }
}

export function isNativeTypeScriptVersion(version: string): boolean {
  const major = +version.split('.', 1)[0]
  return Number.isFinite(major) && major >= 7
}

export function requireTSApi(
  mode: string = 'tsc',
  message: string = '.',
): typeof import('typescript') {
  if (_ts) return _ts

  const tsPkg = getPackageInfo('typescript')
  if (tsPkg && isNativeTypeScriptVersion(tsPkg.version)) {
    throw new Error(
      `TypeScript ${tsPkg.version} does not provide the classic TypeScript API required by ${mode}. Please use TypeScript 6.0 or below${message}`,
    )
  }

  let ts: typeof import('typescript')
  try {
    ts = require('typescript')
  } catch (cause) {
    throw new Error(
      `TypeScript is not installed. Please install the \`typescript\` package (v6.0 or below for the classic API)${
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
