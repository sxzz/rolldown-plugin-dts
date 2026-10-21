import { realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { API, formatDiagnostics, type Snapshot } from 'tsrs/unstable/async'
import { createFileSystemLayer } from 'tsrs/unstable/fs'
import type { Generator, GeneratorResult } from '../../src/index.ts'

export interface TsrsGeneratorOptions {
  tsconfig: string
  cwd?: string
  /** Use source code registered by Rolldown instead of only reading disk. */
  vfs?: boolean
}

/** Experimental custom generator using tsrs's unstable Node API. */
export function createTsrsGenerator({
  tsconfig,
  cwd = process.cwd(),
  vfs = false,
}: TsrsGeneratorOptions): Generator {
  cwd = realpathSync(cwd)
  tsconfig = realpathSync(path.resolve(cwd, tsconfig))
  let api: API | undefined
  let snapshot: Snapshot | undefined
  let queue = Promise.resolve()
  const pendingFiles = new Map<string, string>()
  const openedFiles = new Set<string>()

  function toFileName(fileName: string): string {
    fileName = path.resolve(cwd, fileName)
    try {
      return realpathSync(fileName)
    } catch {
      // Virtual files can live below directories that do not exist yet.
      const parent = path.dirname(fileName)
      return parent === fileName
        ? fileName
        : path.join(toFileName(parent), path.basename(fileName))
    }
  }

  function addFile(code: string, fileName: string): void {
    if (vfs) pendingFiles.set(toFileName(fileName), code)
  }

  async function flushFiles(): Promise<void> {
    if (!pendingFiles.size) return
    const entries = [...pendingFiles]
    pendingFiles.clear()
    const openFiles = entries
      .map(([fileName]) => fileName)
      .filter((fileName) => !openedFiles.has(fileName))
    const previous = snapshot!
    try {
      snapshot = await previous.update({
        fileSystem: createFileSystemLayer(entries),
        ensurePrograms: true,
        openFiles,
      })
    } catch (error) {
      for (const [fileName, code] of entries) {
        if (!pendingFiles.has(fileName)) pendingFiles.set(fileName, code)
      }
      throw error
    }
    for (const fileName of openFiles) openedFiles.add(fileName)
    if (snapshot !== previous) await previous.dispose()
  }

  async function emit(fileName: string): Promise<GeneratorResult> {
    if (!api || !snapshot) {
      throw new Error('The tsrs generator has not been initialized.')
    }
    await flushFiles()

    // Opening a VFS file can select a nearby config. Keep the requested one.
    const project = snapshot.getConfiguredProject(tsconfig)
    if (!project) {
      return { error: `No tsrs project found for ${tsconfig}.` }
    }
    const output = await project.program.getDeclarationEmit([fileName])
    if (output.emitSkipped || output.diagnostics.length) {
      return {
        error: output.diagnostics.length
          ? formatDiagnostics(output.diagnostics, api)
          : `tsrs skipped declaration emit for ${fileName}.`,
      }
    }

    const result: GeneratorResult = {}
    for (const [outputFileName, outputFile] of output.outputFiles) {
      if (
        outputFile.sourceFileName &&
        api.getCanonicalFileName(path.resolve(outputFile.sourceFileName)) !==
          api.getCanonicalFileName(fileName)
      ) {
        continue
      }
      if (/\.d\.[cm]?ts\.map$/.test(outputFileName)) {
        result.map = {
          ...JSON.parse(outputFile.text),
          sources: [fileName],
        }
      } else if (/\.d\.[cm]?ts$/.test(outputFileName)) {
        result.code = outputFile.text
      }
    }
    return result.code === undefined
      ? { error: `tsrs did not generate a declaration file for ${fileName}.` }
      : result
  }

  return {
    async init() {
      await queue
      await api?.close()
      api = snapshot = undefined
      pendingFiles.clear()
      openedFiles.clear()
      queue = Promise.resolve()
      api = new API({ cwd })
      try {
        snapshot = await api.createSnapshot({ openProjects: [tsconfig] })
        const project = snapshot.getConfiguredProject(tsconfig)
        if (!project) throw new Error(`No tsrs project found for ${tsconfig}.`)
        const diagnostics =
          await project.program.getConfigFileParsingDiagnostics()
        if (diagnostics.length) {
          throw new Error(formatDiagnostics(diagnostics, api))
        }
      } catch (error) {
        await api.close()
        api = snapshot = undefined
        throw error
      }
    },
    addFile,
    emit(code, fileName) {
      fileName = toFileName(fileName)
      if (!vfs) return emit(fileName)

      addFile(code, fileName)
      // Snapshot updates and releases must not race concurrent Rolldown loads.
      const result = queue.then(() => emit(fileName))
      queue = result.then(
        () => {},
        () => {},
      )
      return result
    },
    async dispose() {
      await queue
      try {
        await api?.close()
      } finally {
        api = snapshot = undefined
        pendingFiles.clear()
        openedFiles.clear()
      }
    },
  }
}
