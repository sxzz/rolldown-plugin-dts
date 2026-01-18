import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDebug } from 'obug'

const debug = createDebug('rolldown-plugin-dts:tsgo')

const spawnAsync = (...args: Parameters<typeof spawn>) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(...args)
    child.on('close', () => resolve())
    child.on('error', (error) => reject(error))
  })

export async function runTsgo(
  rootDir: string,
  tsconfig?: string,
  sourcemap?: boolean,
  tsgoPath?: string,
) {
  debug('[tsgo] rootDir', rootDir)

  let tsgo: string
  if (tsgoPath) {
    tsgo = tsgoPath
    debug('[tsgo] using custom path', tsgo)
  } else {
    const tsgoPkg = import.meta.resolve(
      '@typescript/native-preview/package.json',
    )
    const { default: getExePath } = await import(
      new URL('lib/getExePath.js', tsgoPkg).href
    )
    tsgo = getExePath()
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
  return tsgoDist
}
