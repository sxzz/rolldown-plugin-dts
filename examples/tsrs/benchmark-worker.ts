/* eslint-disable baseline-js/use-baseline -- This benchmark only runs in Node.js. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { rolldown } from 'rolldown'
import { dts, type Options } from '../../src/index.ts'

const [compiler, configPath] = process.argv.slice(2)
if (!['tsc', 'tsgo', 'tsrs'].includes(compiler) || !configPath) {
  throw new Error('Usage: node benchmark-worker.ts <tsc|tsgo|tsrs> <case.json>')
}
const config = JSON.parse(await readFile(configPath, 'utf8')) as {
  cwd: string
  tsconfig: string
  input: string[]
}
const started = performance.now()
const warnings: string[] = []
const options: Options = {
  cwd: config.cwd,
  tsconfig: config.tsconfig,
  emitDtsOnly: true,
  sourcemap: false,
  logger: { info() {}, warn() {}, error: console.error },
}
if (compiler === 'tsrs') {
  const { createTsrsGenerator } = await import('./generator.ts')
  options.generator = createTsrsGenerator(config)
} else if (compiler === 'tsgo') {
  options.generator = 'tsgo'
  options.tsgo = { moduleUrl: import.meta.resolve('typescript-next') }
} else {
  options.generator = 'tsc'
  options.tsc = { newContext: true, eager: true }
}

const build = await rolldown({
  input: config.input,
  platform: 'node',
  external: (id) => !id.startsWith('.') && !path.isAbsolute(id),
  plugins: dts(options),
  onwarn: (warning) => warnings.push(warning.message),
})
try {
  const { output } = await build.generate({
    dir: path.join(config.cwd, 'dist'),
  })
  const buildMs = performance.now() - started
  const files = []
  for (const file of output) {
    if (file.type !== 'chunk' || !file.fileName.endsWith('.d.ts')) {
      throw new Error(`Unexpected benchmark output: ${file.fileName}`)
    }
    files.push({
      name: file.fileName,
      bytes: Buffer.byteLength(file.code),
      sha256: createHash('sha256').update(file.code).digest('hex'),
      exports: file.exports.toSorted(),
    })
    if (process.env.BENCH_OUTPUT) {
      await mkdir(process.env.BENCH_OUTPUT, { recursive: true })
      await writeFile(
        path.join(process.env.BENCH_OUTPUT, file.fileName),
        file.code,
      )
    }
  }
  console.info(JSON.stringify({ compiler, buildMs, files, warnings }))
} finally {
  await build.close()
}
