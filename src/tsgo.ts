import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDebug } from 'obug'
import type { Logger } from './options.ts'
import { styleText } from 'node:util'

const require = createRequire(import.meta.url)
const debug = createDebug('rolldown-plugin-dts:tsgo')

export function getTypeScriptMajor(): number | undefined {
  try {
    const { version } = require('typescript/package.json')
    const major = +version.split('.', 1)[0]
    return Number.isNaN(major) ? undefined : major
  } catch {
    return
  }
}

export function isTS7Installed(): boolean {
  const major = getTypeScriptMajor()
  return major != null && major >= 7
}

const spawnAsync = (...args: Parameters<typeof spawn>) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(...args)
    child.on('close', () => resolve())
    child.on('error', (error) => reject(error))
  })

let tsgoPathCache: string | undefined

export async function getTsgoPathFromNodeModules(
  logger: Logger,
): Promise<string> {
  if (tsgoPathCache) return tsgoPathCache

  const pkgName = isTS7Installed() ? 'typescript' : '@typescript/native-preview'
  const tsgoPkg = import.meta.resolve(`${pkgName}/package.json`)
  const {
    default: { version },
  } = await import(tsgoPkg, { with: { type: 'json' } })
  logger.info(
    `Emit types with ${styleText('underline', `${pkgName}@${version}`)}`,
  )
  const { default: getExePath } = await import(
    new URL('lib/getExePath.js', tsgoPkg).href
  )
  return (tsgoPathCache = getExePath())
}

export interface TsgoContext {
  path: string
  dispose: () => Promise<void>
}

export async function runTsgo(
  logger: Logger,
  rootDir: string,
  tsconfig?: string,
  sourcemap?: boolean,
  tsgoPath?: string,
): Promise<TsgoContext> {
  debug('[tsgo] rootDir', rootDir)

  let tsgo: string
  if (tsgoPath) {
    tsgo = tsgoPath
    debug('[tsgo] using custom path', tsgo)
  } else {
    tsgo = await getTsgoPathFromNodeModules(logger)
    debug('[tsgo] using tsgo from node_modules', tsgo)
  }

  const tsgoDist = await mkdtemp(path.join(tmpdir(), 'rolldown-plugin-dts-'))
  debug('[tsgo] tsgoDist', tsgoDist)

  const args = [
    '--noEmit',
    'false',
    '--declaration',
    '--emitDeclarationOnly',
    ...(tsconfig ? ['-p', tsconfig] : []),
    '--outDir',
    tsgoDist,
    '--rootDir',
    rootDir,
    '--noCheck',
    ...(sourcemap ? ['--declarationMap'] : []),
  ]
  debug('[tsgo] args %o', args)

  await spawnAsync(tsgo, args, { stdio: 'inherit' })

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
