import { spawn } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDebug } from 'obug'
import { which } from './utils.ts'

const debug = createDebug('rolldown-plugin-dts:tsgo')

const spawnAsync = (...args: Parameters<typeof spawn>) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(...args)
    child.on('close', () => resolve())
    child.on('error', (error) => reject(error))
  })

async function resolveTsgo(): Promise<string> {
  // 1. Try node_modules/.bin/tsgo via @typescript/native-preview
  try {
    const tsgoPkg = import.meta.resolve(
      '@typescript/native-preview/package.json',
    )
    const { default: getExePath } = await import(
      new URL('lib/getExePath.js', tsgoPkg).href
    )
    const tsgoPath = getExePath()
    await access(tsgoPath)
    debug('[tsgo] found in node_modules: %s', tsgoPath)
    return tsgoPath
  } catch {
    debug('[tsgo] not found in node_modules')
  }

  // 2. Try global PATH
  const tsgoPath = which('tsgo')
  if (tsgoPath) {
    debug('[tsgo] found in PATH: %s', tsgoPath)
    return tsgoPath
  }

  // 3. Error
  throw new Error(
    'tsgo not found. Install @typescript/native-preview or ensure tsgo is in your PATH.',
  )
}

export async function runTsgo(
  rootDir: string,
  tsconfig?: string,
  sourcemap?: boolean,
) {
  debug('[tsgo] rootDir', rootDir)

  const tsgo = await resolveTsgo()
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
  return tsgoDist
}
