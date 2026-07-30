import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { styleText } from 'node:util'
import { createDebug } from 'obug'
import { isTS70Installed, require, tryResolve } from './require.ts'
import type { Logger } from './options.ts'

const debug = createDebug('rolldown-plugin-dts:tsgo')

const spawnAsync = (...args: Parameters<typeof spawn>) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(...args)
    child.on('close', () => resolve())
    child.on('error', (error) => reject(error))
  })

let tsgoPathCache: string | undefined

export function resolveTsgoPath(logger: Logger): string {
  if (tsgoPathCache) return tsgoPathCache

  const pkgName = isTS70Installed()
    ? 'typescript'
    : '@typescript/native-preview'

  const pkgJsonPath = tryResolve(`${pkgName}/package.json`)
  if (!pkgJsonPath) {
    throw new Error(
      'TypeScript Go is not installed. Please install the `typescript@7.0` or `@typescript/native-preview` package to use the `tsgo` generator.',
    )
  }

  const { version } = require(pkgJsonPath) as { version: string }
  logger.info(
    `Emit types with ${styleText('underline', `${pkgName}@${version}`)}`,
  )

  const getExePath: any = require(
    path.join(path.dirname(pkgJsonPath), 'lib/getExePath.js'),
  )
  const tsgoPath = (
    typeof getExePath === 'function' ? getExePath : getExePath.default
  )()
  if (import.meta.TEST) {
    return tsgoPath
  }
  return (tsgoPathCache = tsgoPath)
}

export interface TsgoContext {
  path: string
  dispose: () => Promise<void>
}

export async function runTsgo(
  tsgoPath: string,
  rootDir: string,
  tsconfig: string,
  sourcemap?: boolean,
): Promise<TsgoContext> {
  debug('[tsgo] rootDir', rootDir)
  debug('[tsgo] using tsgo binary', tsgoPath)

  const tsgoDist = await mkdtemp(path.join(tmpdir(), 'rolldown-plugin-dts-'))
  debug('[tsgo] tsgoDist', tsgoDist)

  const args = [
    '--noEmit',
    'false',
    '--declaration',
    '--emitDeclarationOnly',
    '-p',
    tsconfig,
    '--outDir',
    tsgoDist,
    '--rootDir',
    rootDir,
    '--noCheck',
    ...(sourcemap ? ['--declarationMap'] : []),
  ]
  debug('[tsgo] args %o', args)

  await spawnAsync(tsgoPath, args, { stdio: 'inherit' })

  return {
    path: tsgoDist,
    async dispose() {
      if (debug.enabled) {
        debug('[tsgo] skip cleanup of tsgoDist', tsgoDist)
      } else {
        debug('[tsgo] disposing tsgoDist', tsgoDist)
        await rm(tsgoDist, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}
