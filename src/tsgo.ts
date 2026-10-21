import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { styleText } from 'node:util'
import { require, tryRequire, tryResolve } from './require.ts'
import type { Logger } from './options.ts'
import type * as TsgoApiModule from 'typescript-next/async'
import type * as TsgoFsModule from 'typescript-next/fs'

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

export function tryLoadTsgoApi(
  moduleUrl: string | undefined,
): typeof TsgoApiModule | undefined {
  if (moduleUrl == null) return

  const modulePath = getTsgoModulePath(moduleUrl)
  const apiPath = tryResolve('typescript/async', {
    paths: [path.dirname(modulePath)],
  })
  const api = apiPath ? tryRequire<typeof TsgoApiModule>(apiPath) : undefined
  return api?.Program?.prototype.getDeclarationEmit ? api : undefined
}

export function loadTsgoApi(
  moduleUrl: string | undefined = getDefaultTsgoModuleUrl(),
  logger?: Logger,
): typeof TsgoApiModule {
  const api = tryLoadTsgoApi(moduleUrl)
  if (!api) {
    throw new Error(
      `The TypeScript module${moduleUrl ? ` at ${moduleUrl}` : ''} does not provide the tsgo \`getDeclarationEmit\` API. Please install \`typescript@7.1.0-beta\` or set \`tsgo.moduleUrl\` to a compatible module, for example \`import.meta.resolve('typescript-next')\`.`,
    )
  }

  if (logger && moduleUrl) {
    logger.info(
      `Emit types with TypeScript Go from ${styleText('underline', moduleUrl)}`,
    )
  }
  return api
}

export function loadTsgoFileSystem(
  moduleUrl: string | undefined = getDefaultTsgoModuleUrl(),
): typeof TsgoFsModule {
  if (moduleUrl == null) throw new Error('No TypeScript module found.')
  const modulePath = getTsgoModulePath(moduleUrl)
  return require(
    require.resolve('typescript/fs', { paths: [path.dirname(modulePath)] }),
  )
}

function getTsgoModulePath(moduleUrl: string): string {
  try {
    if (!moduleUrl.startsWith('file://')) throw new Error('Expected file://')
    return fileURLToPath(moduleUrl)
  } catch (cause) {
    throw new Error(
      "The `tsgo.moduleUrl` option must be a valid file:// URL. Use `import.meta.resolve('typescript')` or `import.meta.resolve('typescript-next')`.",
      { cause },
    )
  }
}
