import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDebug } from 'obug'
import type { TsconfigJson } from 'get-tsconfig'

const debug = createDebug('rolldown-plugin-dts:tsgo')

const spawnAsync = (...args: Parameters<typeof spawn>) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(...args)
    child.on('close', () => resolve())
    child.on('error', (error) => reject(error))
  })

export async function getTsgoPathFromNodeModules(): Promise<string> {
  const tsgoPkg = import.meta.resolve('@typescript/native-preview/package.json')
  const { default: getExePath } = await import(
    new URL('lib/getExePath.js', tsgoPkg).href
  )
  return getExePath()
}

export async function runTsgo(
  rootDir: string,
  tsconfig: string | undefined,
  tsconfigRaw: TsconfigJson,
  isTsconfigOverridden: boolean,
  sourcemap: boolean,
  tsgoPath: string | undefined,
): Promise<{ dist: string; cleanup: () => Promise<void> }> {
  debug('[tsgo] rootDir', rootDir)

  let tsconfigPath: string | undefined
  if (isTsconfigOverridden) {
    tsconfigPath = path.join(rootDir, 'tsconfig.rolldown-plugin-dts.json')
    await writeFile(tsconfigPath, JSON.stringify(tsconfigRaw, null, 2))
    debug('[tsgo] using overridden tsconfig file', tsconfigPath)
  } else {
    tsconfigPath = tsconfig
    debug('[tsgo] using original tsconfig file', tsconfigPath)
  }

  let tsgo: string
  if (tsgoPath) {
    tsgo = tsgoPath
    debug('[tsgo] using custom path', tsgo)
  } else {
    tsgo = await getTsgoPathFromNodeModules()
    debug('[tsgo] using tsgo from node_modules', tsgo)
  }

  const tsgoDist = await mkdtemp(path.join(tmpdir(), 'rolldown-plugin-dts-'))
  debug('[tsgo] tsgoDist', tsgoDist)

  const args = [
    '--noEmit',
    'false',
    '--declaration',
    '--emitDeclarationOnly',
    ...(tsconfigPath ? ['-p', tsconfigPath] : []),
    '--outDir',
    tsgoDist,
    '--rootDir',
    rootDir,
    '--noCheck',
    ...(sourcemap ? ['--declarationMap'] : []),
  ]
  debug('[tsgo] args %o', args)

  const cleanupTsgoOutput = async () => {
    if (isTsconfigOverridden && tsconfigPath) {
      debug('[tsgo] cleaning up tsgo tsconfig', tsconfigPath)
      await rm(tsconfigPath, { force: true }).catch(() => {})
    }

    debug('[tsgo] cleaning up tsgo dist', tsgoDist)
    await rm(tsgoDist, { recursive: true, force: true }).catch(() => {})
  }

  await spawnAsync(tsgo, args, { stdio: 'inherit' })
  return { dist: tsgoDist, cleanup: cleanupTsgoOutput }
}
