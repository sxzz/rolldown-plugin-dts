import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { styleText } from 'node:util'
import { tryRequire, tryResolve } from './require.ts'
import type { Logger } from './options.ts'

export interface TsgoPackageInfo {
  moduleUrl: string
  api?: TsgoApiModule
  hasClassicApi: boolean
}

export type TsgoApiModule = typeof import('typescript-next/unstable/async')

export function getDefaultTsgoModuleUrl(): string | undefined {
  try {
    // Tests replace the CommonJS resolver to exercise different installations.
    if (import.meta.TEST) {
      const modulePath = tryResolve('typescript')
      return modulePath && pathToFileURL(modulePath).href
    }
    return import.meta.resolve('typescript')
  } catch {}
}

function getModulePath(moduleUrl: string): string {
  return moduleUrl.startsWith('file:') ? fileURLToPath(moduleUrl) : moduleUrl
}

export function getTsgoPackageInfo(
  moduleUrl: string | undefined,
): TsgoPackageInfo | undefined {
  if (!moduleUrl) return

  let modulePath: string
  try {
    modulePath = getModulePath(moduleUrl)
  } catch {
    return { moduleUrl, hasClassicApi: false }
  }

  const rootModule = tryRequire<TsgoApiModule & typeof import('typescript')>(
    modulePath,
  )
  const apiPath = tryResolve('typescript/unstable/async', {
    paths: [path.dirname(modulePath)],
  })
  const api = rootModule?.Program?.prototype.getDeclarationEmit
    ? rootModule
    : apiPath
      ? tryRequire<TsgoApiModule>(apiPath)
      : undefined
  return {
    moduleUrl,
    api,
    hasClassicApi: typeof rootModule?.createProgram === 'function',
  }
}

export function getDefaultTsgoGenerator(): 'tsgo' | undefined {
  const pkg = getTsgoPackageInfo(getDefaultTsgoModuleUrl())
  if (
    pkg?.api?.Program?.prototype.getDeclarationEmit ||
    (pkg && !pkg.hasClassicApi)
  ) {
    return 'tsgo'
  }
}

function logPackage(logger: Logger, pkg: TsgoPackageInfo): void {
  logger.info(
    `Emit types with TypeScript Go from ${styleText('underline', pkg.moduleUrl)}`,
  )
}

export function resolveTsgoApiPackage(
  logger?: Logger,
  moduleUrl: string | undefined = getDefaultTsgoModuleUrl(),
): TsgoPackageInfo {
  const pkg = getTsgoPackageInfo(moduleUrl)
  if (!pkg?.api?.Program?.prototype.getDeclarationEmit) {
    throw new Error(
      `The TypeScript module${moduleUrl ? ` at ${moduleUrl}` : ''} does not provide the tsgo \`getDeclarationEmit\` API. Please install \`typescript@next\` or set \`tsgo.moduleUrl\` to a compatible module, for example \`import.meta.resolve('typescript-next')\`.`,
    )
  }

  if (logger) logPackage(logger, pkg)
  return pkg
}

export function loadTsgoApi(
  moduleUrl: string | undefined = getDefaultTsgoModuleUrl(),
): TsgoApiModule {
  const pkg = resolveTsgoApiPackage(undefined, moduleUrl)
  return pkg.api!
}
