/* eslint-disable baseline-js/use-baseline -- This benchmark only runs in Node.js. */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs, promisify } from 'node:util'

const root = path.resolve(import.meta.dirname, '../..')
const worker = path.join(import.meta.dirname, 'benchmark-worker.ts')
const compilers = ['tsc', 'tsgo', 'tsrs'] as const
type Compiler = (typeof compilers)[number]
interface OutputFile {
  name: string
  bytes: number
  sha256: string
  exports: string[]
}
interface RunResult {
  compiler: Compiler
  buildMs: number
  files: OutputFile[]
  warnings: string[]
  wallMs: number
  peakRssMiB: number | null
  samples: number
  maxProcesses: number
}
interface Row {
  output: OutputFile[]
  timing: RunResult[]
  memory: RunResult[]
  summary?: {
    medianMs: number
    minMs: number
    maxMs: number
    medianPeakRssMiB: number
    maxPeakRssMiB: number
  }
}
const exec = promisify(execFile)
const require = createRequire(import.meta.url)

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await writeFile(fileName, `${JSON.stringify(value, null, 2)}\n`)
}

async function prepareCase(
  directory: string,
  count: number,
): Promise<string[]> {
  await mkdir(directory, { recursive: true })
  for (let i = 0; i < count; i++) {
    const previous = Math.max(0, i - 1)
    const dependency = i
      ? `import type { Model${previous} } from './module${previous}.js'\n`
      : ''
    await writeFile(
      path.join(directory, `module${i}.ts`),
      `${dependency}
export interface Model${i}<T = string> {
  id: number
  name: string
  value: T
  tags: readonly string[]
  status: 'pending' | 'done'
  metadata: Record<string, string | number>
}
export type Patch${i}<T> = { readonly [K in keyof T]?: T[K] }
export type Result${i}<T> = { ok: true; value: T } | { ok: false; error: Error }
export type Value${i}<T> = T extends Result${i}<infer V> ? V : never
export function create${i}(value: string, id = ${i}) {
  return { id, name: 'model${i}', value, tags: ['a', 'b'], status: 'pending' as const, metadata: { version: 1 } }
}
export function update${i}(model: Model${i}, patch: Patch${i}<Model${i}>) {
  return { ...model, ...patch }
}
export async function fetch${i}(id: number) { return create${i}('value', id) }
export const defaults${i} = { retries: 3, mode: 'strict' as const, enabled: true }
export type Linked${i} = { current: Model${i}; previous?: Model${previous} }
`,
    )
  }
  const entry = path.join(directory, 'index.ts')
  await writeFile(
    entry,
    Array.from(
      { length: count },
      (_, i) => `export * from './module${i}.js'\n`,
    ).join(''),
  )
  await writeJson(path.join(directory, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      types: [],
      declaration: true,
      emitDeclarationOnly: true,
      noEmitOnError: false,
      declarationMap: false,
    },
    include: ['*.ts'],
  })
  return [entry]
}

async function run(
  compiler: Compiler,
  caseFile: string,
  sampleMemory = false,
  outputDir?: string,
): Promise<RunResult> {
  const env = { ...process.env }
  delete env.DEBUG
  if (outputDir) env.BENCH_OUTPUT = outputDir
  else delete env.BENCH_OUTPUT

  const started = performance.now()
  // A separate process group includes the native server in RSS samples.
  const child = spawn(process.execPath, [worker, compiler, caseFile], {
    cwd: root,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let done = false
  let wallMs = 0
  let timedOut = false
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  child.once('exit', () => {
    wallMs = performance.now() - started
  })
  const finished = new Promise<Error | null>((resolve) => {
    child.once('error', (error) => {
      done = true
      resolve(error)
    })
    child.once('close', (code, signal) => {
      done = true
      resolve(
        code === 0
          ? null
          : new Error(
              `${compiler} exited with ${code ?? signal}: ${stdout}\n${stderr}`,
            ),
      )
    })
  })
  function kill(): void {
    if (!child.pid) return
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  const timeout = setTimeout(() => {
    timedOut = true
    kill()
  }, 180_000)
  const interrupt = () => {
    kill()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  let peakKiB = 0
  let samples = 0
  let maxProcesses = 0
  try {
    if (sampleMemory) {
      while (!done && child.pid) {
        const { stdout: sample } = await exec('ps', [
          '-g',
          String(child.pid),
          '-o',
          'pid=,rss=',
        ]).catch((error: unknown) => {
          // ps exits with 1 when the process group has already exited.
          if ((error as { code?: number }).code === 1) return { stdout: '' }
          throw error
        })
        const rows = sample.trim() ? sample.trim().split('\n') : []
        peakKiB = Math.max(
          peakKiB,
          rows.reduce(
            (sum, row) => sum + Number(row.trim().split(/\s+/, 2)[1]),
            0,
          ),
        )
        maxProcesses = Math.max(maxProcesses, rows.length)
        samples++
        await Promise.race([finished, delay(10)])
      }
    }
    // Exit events avoid polling overhead in timing-only runs.
    const error = await finished
    if (timedOut) throw new Error('Benchmark exceeded 180 seconds')
    if (error) throw error
    const result = JSON.parse(stdout) as RunResult
    assert.equal(
      result.warnings.length,
      0,
      `Build warnings: ${result.warnings}`,
    )
    if (sampleMemory) assert.ok(peakKiB > 0, 'No process RSS samples collected')
    return {
      ...result,
      wallMs,
      peakRssMiB: sampleMemory ? peakKiB / 1024 : null,
      samples,
      maxProcesses,
    }
  } finally {
    clearTimeout(timeout)
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    if (!done) {
      kill()
      await finished
    }
  }
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

// Seeded Fisher–Yates shuffle keeps compiler order reproducible.
let seed = 42
function shuffledCompilers(): Compiler[] {
  const order = [...compilers]
  for (let i = order.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const j = Math.floor((seed / 2 ** 32) * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

function normalizeQuotes(text: string): string {
  // TS 6 and TS 7 print these fixture string literals differently.
  for (const literal of ['pending', 'done', 'strict']) {
    text = text.replaceAll(`"${literal}"`, `'${literal}'`)
  }
  return text
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin')
    throw new Error('RSS sampling currently requires macOS')
  const { values } = parseArgs({
    options: {
      runs: { type: 'string', default: '7' },
      'memory-runs': { type: 'string', default: '3' },
    },
  })
  const timingRuns = Number(values.runs)
  const memoryRuns = Number(values['memory-runs'])
  for (const count of [timingRuns, memoryRuns]) {
    assert.ok(
      Number.isSafeInteger(count) && count > 0,
      'Run counts must be positive integers',
    )
  }
  const resultsDir = path.join(
    root,
    'temp',
    `tsrs-benchmark-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
  )
  await mkdir(resultsDir, { recursive: true })
  const cases: Record<string, string> = {}
  const repository = path.join(resultsDir, 'repository')
  await mkdir(repository)
  await writeJson(path.join(repository, 'tsconfig.json'), {
    extends: path.join(root, 'tsconfig.json'),
    compilerOptions: {
      noEmit: false,
      emitDeclarationOnly: true,
      noEmitOnError: false,
      declarationMap: false,
      isolatedDeclarations: false,
    },
    include: [path.join(root, 'src/**/*.ts')],
    exclude: [],
  })
  cases.repository = path.join(repository, 'case.json')
  await writeJson(cases.repository, {
    cwd: root,
    tsconfig: path.join(repository, 'tsconfig.json'),
    input: [
      'index.ts',
      'internal.ts',
      'tsc/index.ts',
      'tsc/context.ts',
      'tsc/worker.ts',
    ].map((name) => path.join(root, 'src', name)),
  })
  for (const count of [100, 1000]) {
    const name = `synthetic-${count}`
    const directory = path.join(resultsDir, name)
    const input = await prepareCase(directory, count)
    cases[name] = path.join(directory, 'case.json')
    await writeJson(cases[name], {
      cwd: directory,
      tsconfig: path.join(directory, 'tsconfig.json'),
      input,
    })
  }
  const caseResults: Record<string, Record<Compiler, Row>> = {}
  const results = {
    metadata: {
      node: process.version,
      cpu: os.cpus()[0].model,
      memoryBytes: os.totalmem(),
      os: (await exec('sw_vers')).stdout.trim(),
      versions: Object.fromEntries(
        ['typescript', 'typescript-next', 'tsrs', 'rolldown'].map((name) => [
          name,
          require(`${name}/package.json`).version,
        ]),
      ),
      timingRuns,
      memoryRuns,
      shuffleSeed: 42,
      memoryMethod:
        'sum RSS of process group sampled with ps, 10ms sleep between samples; separate from timing runs',
    },
    cases: caseResults,
  }
  console.info(`Results: ${resultsDir}`)
  for (const [name, caseFile] of Object.entries(cases)) {
    const rows = Object.fromEntries(
      compilers.map((compiler): [Compiler, Row] => [
        compiler,
        { output: [], timing: [], memory: [] },
      ]),
    ) as Record<Compiler, Row>
    results.cases[name] = rows
    for (const compiler of compilers) {
      const result = await run(
        compiler,
        caseFile,
        false,
        path.join(resultsDir, name, compiler),
      )
      rows[compiler].output = result.files
      console.info(`${name} ${compiler}: warmup ${result.wallMs.toFixed(0)}ms`)
    }
    const shape = (files: OutputFile[]) =>
      files.map(({ name, bytes, exports }) => ({ name, bytes, exports }))
    for (const compiler of compilers) {
      assert.deepEqual(
        shape(rows[compiler].output),
        shape(rows.tsc.output),
        `${compiler}: output sizes or exports differ from tsc`,
      )
      for (const file of rows[compiler].output) {
        const baseline = await readFile(
          path.join(resultsDir, name, 'tsc', file.name),
          'utf8',
        )
        const emitted = await readFile(
          path.join(resultsDir, name, compiler, file.name),
          'utf8',
        )
        assert.equal(
          normalizeQuotes(emitted),
          normalizeQuotes(baseline),
          `${compiler}: declarations differ beyond fixture literal quote style`,
        )
      }
    }
    for (const [phase, repeats] of [
      ['timing', timingRuns],
      ['memory', memoryRuns],
    ] as const) {
      for (let index = 0; index < repeats; index++) {
        for (const compiler of shuffledCompilers()) {
          const result = await run(compiler, caseFile, phase === 'memory')
          assert.deepEqual(
            result.files,
            rows[compiler].output,
            'Non-deterministic declaration output',
          )
          rows[compiler][phase].push(result)
        }
        console.info(`${name} ${phase} ${index + 1}/${repeats}`)
      }
    }
    for (const compiler of compilers) {
      const row = rows[compiler]
      const wall = row.timing.map((result) => result.wallMs)
      const memory = row.memory.map((result) => result.peakRssMiB!)
      row.summary = {
        medianMs: median(wall),
        minMs: Math.min(...wall),
        maxMs: Math.max(...wall),
        medianPeakRssMiB: median(memory),
        maxPeakRssMiB: Math.max(...memory),
      }
      console.info(name, compiler, row.summary)
    }
    await writeJson(path.join(resultsDir, 'results.json'), results)
  }
  console.info(`Saved ${path.join(resultsDir, 'results.json')}`)
}

await main()
