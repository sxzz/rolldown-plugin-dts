import path from 'node:path'
import { normalizePath } from '../utils/path.ts'
import { requireTSApi } from '../utils/require.ts'
import type {
  CompilerHost,
  CompilerOptions,
  DocumentRegistry,
} from 'typescript'

// Every program parses the default lib files again, which are several MB and
// never change. Share them between programs like the language service does:
// the registry keys them by the compiler options that affect parsing and
// binding. They are kept for the lifetime of the process, like the programs of
// the global context.
let registry: DocumentRegistry | undefined

export function shareLibFiles(
  host: CompilerHost,
  options: CompilerOptions,
): void {
  const ts = requireTSApi()
  const current = (registry ??= ts.createDocumentRegistry(
    ts.sys.useCaseSensitiveFileNames,
  ))
  const libDir = normalizePath(path.dirname(ts.getDefaultLibFilePath(options)))
  const { getSourceFile } = host
  host.getSourceFile = (fileName, languageVersionOrOptions, ...args) => {
    const [, shouldCreateNewSourceFile] = args
    const text =
      !shouldCreateNewSourceFile &&
      path.posix.dirname(normalizePath(fileName)) === libDir
        ? host.readFile(fileName)
        : undefined
    if (text === undefined) {
      return getSourceFile(fileName, languageVersionOrOptions, ...args)
    }
    return current.acquireDocument(
      fileName,
      options,
      ts.ScriptSnapshot.fromString(text),
      // The files never change, so every program gets the same version.
      '0',
      undefined,
      languageVersionOrOptions,
    )
  }
}
