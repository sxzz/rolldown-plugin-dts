import { fork } from 'node:child_process'
import { is } from 'yuku-ast'
import { parse, type TSPropertySignature } from 'yuku-parser'
import { RE_JSON } from '../filename.ts'
import {
  createContext,
  globalContext,
  invalidateContextFile,
  type TscContext,
} from '../tsc/context.ts'
import type { TscOptions, TscResult } from '../tsc/index.ts'
import type { WorkerRequest, WorkerResponse } from '../tsc/worker.ts'
import type { Generator } from './index.ts'

const WORKER_URL = import.meta.WORKER_URL || '../tsc/worker.ts'

type TscGeneratorOptions = Omit<TscOptions, 'id' | 'entries' | 'context'> & {
  parallel: boolean
  newContext: boolean
  getEntries: () => string[] | undefined
}

export class TscGenerator implements Generator {
  private options: Omit<TscOptions, 'id' | 'entries' | 'context'>
  private parallel: boolean
  private newContext: boolean
  private getEntries: () => string[] | undefined
  private worker?: TscWorker
  private tscModule?: typeof import('../tsc/index.ts')
  private context?: TscContext

  constructor({
    parallel,
    newContext,
    getEntries,
    ...options
  }: TscGeneratorOptions) {
    this.options = options
    this.parallel = parallel
    this.newContext = newContext
    this.getEntries = getEntries
  }

  async init(): Promise<void> {
    if (this.parallel) {
      this.worker = createTscWorker()
      return
    }

    this.tscModule = await import('../tsc/index.ts')
    if (this.newContext) {
      this.context = createContext()
    }
  }

  async emit(_code: string, fileName: string): Promise<TscResult> {
    const options: TscOptions = {
      ...this.options,
      entries: this.getEntries(),
      id: fileName,
      context: this.context,
    }

    let result: TscResult
    if (this.parallel) {
      if (!this.worker) {
        throw new Error('TscGenerator has not been initialized.')
      }
      result = await this.worker.emit(options)
    } else {
      if (!this.tscModule) {
        throw new Error('TscGenerator has not been initialized.')
      }
      result = this.tscModule.tscEmit(options)
    }

    if (result.code && RE_JSON.test(fileName)) {
      result.code = patchJsonDts(result.code)
    }

    return result
  }

  dispose(): void {
    this.worker?.kill()
    this.worker = undefined
    this.tscModule = undefined
    if (this.newContext) {
      this.context = undefined
    }
  }

  invalidate(fileName: string): void {
    if (this.parallel) return

    if (this.newContext) {
      if (this.context) {
        invalidateContextFile(this.context, fileName)
      }
    } else {
      invalidateContextFile(globalContext, fileName)
    }
  }
}

interface TscWorker {
  emit: (options: TscOptions) => Promise<TscResult>
  kill: () => void
}

function createTscWorker(): TscWorker {
  const childProcess = fork(new URL(WORKER_URL, import.meta.url), {
    stdio: 'inherit',
    serialization: 'advanced',
  })

  const pending = new Map<
    number,
    {
      resolve: (result: TscResult) => void
      reject: (error: unknown) => void
    }
  >()
  let nextId = 0

  childProcess.on('message', (response: WorkerResponse) => {
    const handler = pending.get(response.id)
    if (!handler) return
    pending.delete(response.id)
    if (response.error) {
      handler.reject(response.error)
    } else {
      handler.resolve(response.result!)
    }
  })

  childProcess.on('exit', (code) => {
    for (const handler of pending.values()) {
      handler.reject(new Error(`tsc worker exited with code ${code}`))
    }
    pending.clear()
  })

  return {
    emit: (options) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        childProcess.send({ id, options } satisfies WorkerRequest)
      }),
    kill: () => childProcess.kill(),
  }
}

function patchJsonDts(code: string): string {
  // If the declaration contains invalid JSON keys, add named exports.
  if (code.includes('declare const _exports')) {
    if (
      code.includes('declare const _exports: {') &&
      !code.includes('\n}[];')
    ) {
      const exports = collectJsonExports(code)
      let index = 0
      code += exports
        .map((exported) => {
          const valid = `_${exported.replaceAll(/[^\w$]/g, '_')}${index++}`
          const jsonKey = JSON.stringify(exported)
          return `declare let ${valid}: typeof _exports[${jsonKey}]\nexport { ${valid} as ${jsonKey} }`
        })
        .join('\n')
    }
    return code
  }

  // Otherwise add a default export.
  const exportMap = collectJsonExportMap(code)
  code += `
declare namespace __json_default_export {
  export { ${Array.from(exportMap.entries(), ([exported, local]) =>
    exported === local ? exported : `${local} as ${exported}`,
  ).join(', ')} }
}
export { __json_default_export as default }`
  return code
}

function collectJsonExportMap(code: string): Map<string, string> {
  const exportMap = new Map<string, string>()
  const { program } = parse(code, { sourceType: 'module', lang: 'dts' })

  for (const decl of program.body) {
    if (decl.type === 'ExportNamedDeclaration') {
      // export declare let Hello: string;
      if (decl.declaration) {
        if (decl.declaration.type === 'VariableDeclaration') {
          for (const vdecl of decl.declaration.declarations) {
            if (vdecl.id.type === 'Identifier') {
              exportMap.set(vdecl.id.name, vdecl.id.name)
            }
          }
        } else if (
          decl.declaration.type === 'TSModuleDeclaration' &&
          decl.declaration.id.type === 'Identifier'
        ) {
          exportMap.set(decl.declaration.id.name, decl.declaration.id.name)
        }
      } else if (decl.specifiers.length) {
        for (const spec of decl.specifiers) {
          if (
            spec.type === 'ExportSpecifier' &&
            spec.exported.type === 'Identifier'
          ) {
            // declare let _class: string
            // export { _class as class }
            exportMap.set(
              spec.exported.name,
              spec.local.type === 'Identifier'
                ? spec.local.name
                : spec.exported.name,
            )
          }
        }
      }
    }
  }

  return exportMap
}

/** `declare const _exports` mode */
function collectJsonExports(code: string) {
  const exports: string[] = []
  const { program } = parse(code, { sourceType: 'module', lang: 'dts' })
  const members = (program.body as any)[0].declarations[0].id.typeAnnotation
    .typeAnnotation.members as TSPropertySignature[]

  for (const member of members) {
    if (member.key.type === 'Identifier') {
      exports.push(member.key.name)
    } else if (is.StringLiteral(member.key)) {
      exports.push(member.key.value)
    }
  }

  return exports
}
