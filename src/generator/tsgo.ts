import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { styleText } from 'node:util'
import { createDebug } from 'obug'
import { filename_to_dts } from '../filename.ts'
import { isTS70Installed, require, tryResolve } from '../require.ts'
import type { LanguageContext } from '../custom-language.ts'
import type { Logger } from '../options.ts'
import type { Generator, GeneratorResult } from './index.ts'
import type { SourceMapInput } from 'rolldown'

const debug = createDebug('rolldown-plugin-dts:tsgo')

const spawnAsync = (...args: Parameters<typeof spawn>) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(...args)
    child.on('close', (code, signal) => {
      if (code === 0) resolve()
      else if (signal)
        reject(new Error(`tsgo process terminated by signal ${signal}`))
      else reject(new Error(`tsgo process exited with code ${code}`))
    })
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

export interface TsgoGeneratorOptions {
  tsgoPath: string
  rootDir: string
  tsconfig: string
  sourcemap?: boolean
  languageContext: LanguageContext
}

export class TsgoGenerator implements Generator {
  private options: TsgoGeneratorOptions
  private context?: TsgoContext

  constructor(options: TsgoGeneratorOptions) {
    this.options = options
  }

  async init(): Promise<void> {
    const { tsgoPath, rootDir, tsconfig, sourcemap } = this.options
    this.context = await runTsgo(tsgoPath, rootDir, tsconfig, sourcemap)
  }

  async emit(_code: string, fileName: string): Promise<GeneratorResult> {
    const { rootDir, languageContext } = this.options
    if (languageContext.isCustomLanguageFile(fileName)) {
      return {
        error: `tsgo does not support ${path.extname(fileName)} files.`,
      }
    }
    if (!this.context) {
      throw new Error('TsgoGenerator has not been initialized.')
    }

    const dtsPath = path.resolve(
      this.context.path,
      path.relative(
        path.resolve(rootDir),
        filename_to_dts(fileName, languageContext),
      ),
    )
    if (!existsSync(dtsPath)) {
      debug('[tsgo]', dtsPath, 'is missing')
      return {
        error: `tsgo did not generate dts file for ${fileName}, please check your tsconfig.`,
      }
    }

    const code = await readFile(dtsPath, 'utf8')
    let map: SourceMapInput | undefined
    const mapPath = `${dtsPath}.map`
    if (existsSync(mapPath)) {
      const mapRaw = await readFile(mapPath, 'utf8')
      map = {
        ...JSON.parse(mapRaw),
        sources: [fileName],
      }
    }

    return { code, map }
  }

  async dispose(): Promise<void> {
    await this.context?.dispose()
    this.context = undefined
  }
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
