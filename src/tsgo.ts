import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { styleText } from 'node:util'
import { tryRequire, tryResolve } from './require.ts'
import type { Logger } from './options.ts'

export interface TsgoPackageInfo {
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

export function getTsgoPackageInfo(
  moduleUrl: string | undefined,
): TsgoPackageInfo | undefined {
  if (!moduleUrl) return

  let modulePath = moduleUrl
  try {
    if (moduleUrl.startsWith('file:')) modulePath = fileURLToPath(moduleUrl)
  } catch {
    return
  }

  const ts = tryRequire<TsgoApiModule & typeof import('typescript')>(modulePath)
  const apiPath = tryResolve('typescript/unstable/async', {
    paths: [path.dirname(modulePath)],
  })
  const api = ts?.Program?.prototype.getDeclarationEmit
    ? ts
    : apiPath
      ? tryRequire<TsgoApiModule>(apiPath)
      : undefined
  return {
    api,
    hasClassicApi: typeof ts?.createProgram === 'function',
  }
}

export function loadTsgoApi(
  moduleUrl: string | undefined = getDefaultTsgoModuleUrl(),
  logger?: Logger,
): TsgoApiModule {
  const pkg = getTsgoPackageInfo(moduleUrl)
  if (!pkg?.api?.Program?.prototype.getDeclarationEmit) {
    throw new Error(
      `The TypeScript module${moduleUrl ? ` at ${moduleUrl}` : ''} does not provide the tsgo \`getDeclarationEmit\` API. Please install \`typescript@next\` or set \`tsgo.moduleUrl\` to a compatible module, for example \`import.meta.resolve('typescript-next')\`.`,
    )
  }

  if (logger && moduleUrl) {
    logger.info(
      `Emit types with TypeScript Go from ${styleText('underline', moduleUrl)}`,
    )
  }
  return pkg.api
}
