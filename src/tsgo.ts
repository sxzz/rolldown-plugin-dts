import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDebug } from 'obug'

const debug = createDebug('rolldown-plugin-dts:tsgo')

/**
 * Promisified wrapper around {@linkcode spawn} that resolves when the child
 * process exits and rejects if the process emits an error.
 *
 * @param args - Arguments forwarded verbatim to {@linkcode spawn}.
 */
const spawnAsync = (...args: Parameters<typeof spawn>) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(...args)
    child.on('close', () => resolve())
    child.on('error', (error) => reject(error))
  })

/**
 * Resolves the path to the `tsgo` binary bundled inside the
 * {@linkcode https://github.com/microsoft/typescript-go | @typescript/native-preview}
 * package.
 *
 * @returns The absolute path to the `tsgo` executable.
 */
export async function getTsgoPathFromNodeModules(): Promise<string> {
  const tsgoPkg = import.meta.resolve('@typescript/native-preview/package.json')
  const { default: getExePath } = await import(
    new URL('lib/getExePath.js', tsgoPkg).href
  )
  return getExePath()
}

/**
 * Runs `tsgo` to emit declaration files into a temporary directory and returns
 * that directory's path. The caller is responsible for cleaning it up.
 *
 * @param rootDir - The project root passed to `tsgo` via `--rootDir`.
 * @param [tsconfig] - Optional path to a {@linkcode https://www.typescriptlang.org/docs/handbook/tsconfig-json.html | tsconfig.json} file passed via `-p`.
 * @param [sourcemap] - If `true`, passes `--declarationMap` to emit `.d.ts.map` files.
 * @param [tsgoPath] - Optional explicit path to the `tsgo` binary. Falls back to resolving from {@linkcode https://github.com/microsoft/typescript-go | @typescript/native-preview} in `node_modules`.
 * @returns The path to the temporary directory containing the emitted `.d.ts` files.
 */
export async function runTsgo(
  rootDir: string,
  tsconfig?: string,
  sourcemap?: boolean,
  tsgoPath?: string,
): Promise<string> {
  debug('[tsgo] rootDir', rootDir)

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
