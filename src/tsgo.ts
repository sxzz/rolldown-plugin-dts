import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isTS70Installed, require, tryRequire, tryResolve } from './require.ts'
import type { Logger } from './options.ts'
import type * as TsgoApiModule from 'typescript-next/async'
import type * as TsgoFsModule from 'typescript-next/fs'

/** Compilers exposing the TypeScript Go Node API. */
export type NativeCompiler = 'tsgo' | 'tsrs'

const PACKAGE_NAMES: Record<NativeCompiler, string> = {
  tsgo: 'typescript',
  tsrs: 'tsrs',
}

function resolveSubpath(
  compiler: NativeCompiler,
  modulePath: string,
  subpath: string,
): string | undefined {
  const packageName = PACKAGE_NAMES[compiler]
  const paths = [path.dirname(modulePath)]
  return tryResolve(`${packageName}/${subpath}`, { paths })
}

export function getDefaultTsgoModuleUrl(
  compiler: NativeCompiler = 'tsgo',
): string | undefined {
  const packageName = PACKAGE_NAMES[compiler]
  try {
    // Tests replace the CommonJS resolver to exercise different installations.
    if (import.meta.TEST) {
      const modulePath = tryResolve(packageName)
      return modulePath && pathToFileURL(modulePath).href
    }
    return import.meta.resolve(packageName)
  } catch {}
}

export function tryLoadTsgoApi(
  moduleUrl: string | undefined,
  compiler: NativeCompiler = 'tsgo',
): typeof TsgoApiModule | undefined {
  if (moduleUrl == null) return

  const modulePath = getTsgoModulePath(moduleUrl, compiler)
  const apiPath = resolveSubpath(compiler, modulePath, 'async')
  const api = apiPath ? tryRequire<typeof TsgoApiModule>(apiPath) : undefined
  return api?.Program?.prototype.getDeclarationEmit ? api : undefined
}

/**
 * TypeScript 7.0 only ships the `tsgo` CLI, without the declaration emit API.
 *
 * @deprecated Remove together with the CLI backend in the next minor.
 */
export function isLegacyTsgo(moduleUrl: string | undefined): boolean {
  return (
    isTS70Installed() &&
    moduleUrl === getDefaultTsgoModuleUrl() &&
    !tryLoadTsgoApi(moduleUrl)
  )
}

export function loadTsgoApi(
  moduleUrl: string | undefined,
  logger?: Logger,
  compiler: NativeCompiler = 'tsgo',
): typeof TsgoApiModule {
  moduleUrl ??= getDefaultTsgoModuleUrl(compiler)
  const api = tryLoadTsgoApi(moduleUrl, compiler)
  if (!api) {
    throw new Error(
      compiler === 'tsrs'
        ? 'tsrs is not installed or does not support declaration emit. Install `tsrs` or set `tsrs.moduleUrl` to a compatible version.'
        : 'The selected TypeScript version does not support tsgo. Install `typescript@7.1.0-beta` or newer, or set `tsgo.moduleUrl` to a compatible version.',
    )
  }

  logger?.info(
    compiler === 'tsrs'
      ? 'Emit types with tsrs'
      : 'Emit types with TypeScript Go',
  )
  return api
}

export function loadTsgoFileSystem(
  moduleUrl: string | undefined,
  compiler: NativeCompiler = 'tsgo',
): typeof TsgoFsModule {
  moduleUrl ??= getDefaultTsgoModuleUrl(compiler)
  if (moduleUrl == null) {
    throw new Error(
      compiler === 'tsrs'
        ? 'No tsrs module found.'
        : 'No TypeScript module found.',
    )
  }
  const modulePath = getTsgoModulePath(moduleUrl, compiler)
  const fsPath = resolveSubpath(compiler, modulePath, 'fs')
  if (!fsPath) {
    throw new Error(
      `Cannot find the ${PACKAGE_NAMES[compiler]} filesystem API from ${modulePath}.`,
    )
  }
  return require(fsPath)
}

function getTsgoModulePath(
  moduleUrl: string,
  compiler: NativeCompiler,
): string {
  try {
    if (!moduleUrl.startsWith('file://')) throw new Error('Expected file://')
    return fileURLToPath(moduleUrl)
  } catch (cause) {
    throw new Error(
      compiler === 'tsrs'
        ? "The `tsrs.moduleUrl` option must be a valid file:// URL. Use `import.meta.resolve('tsrs')`."
        : "The `tsgo.moduleUrl` option must be a valid file:// URL. Use `import.meta.resolve('typescript')` or `import.meta.resolve('typescript-next')`.",
      { cause },
    )
  }
}
