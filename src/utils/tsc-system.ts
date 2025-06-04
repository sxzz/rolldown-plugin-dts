import Debug from 'debug'
import ts from 'typescript'

const debug = Debug('rolldown-plugin-dts:tsc-system')

const files: Map<string, string> = new Map()

// A system that writes files to both memory and disk. It will try read files
// from memory firstly and fallback to disk if not found.ƒ
export const fsSystem: ts.System = {
  ...ts.sys,

  // Hide the output of tsc by default
  write(message: string): void {
    debug(message)
  },

  // Copied from
  // https://github.com/microsoft/TypeScript-Website/blob/b0e9a5c0/packages/typescript-vfs/src/index.ts#L571C5-L574C7
  resolvePath(path) {
    if (files.has(path)) {
      return path
    }
    return ts.sys.resolvePath(path)
  },

  // Copied from
  // https://github.com/microsoft/TypeScript-Website/blob/b0e9a5c0/packages/typescript-vfs/src/index.ts#L532C1-L534C8
  directoryExists(directory) {
    if (Array.from(files.keys()).some((path) => path.startsWith(directory))) {
      return true
    }
    return ts.sys.directoryExists(directory)
  },

  fileExists(fileName) {
    if (files.has(fileName)) {
      return true
    }
    return ts.sys.fileExists(fileName)
  },

  readFile(fileName, ...args) {
    if (files.has(fileName)) {
      return files.get(fileName)
    }
    return ts.sys.readFile(fileName, ...args)
  },

  writeFile(path, data, ...args) {
    files.set(path, data)
    ts.sys.writeFile(path, data, ...args)
  },

  deleteFile(fileName, ...args) {
    files.delete(fileName)
    ts.sys.deleteFile?.(fileName, ...args)
  },
}

// A system that only writes files to memory. It will read files from both
// memory and disk.
export const memorySystem: ts.System = {
  ...fsSystem,

  writeFile(path, data) {
    files.set(path, data)
  },

  deleteFile(fileName) {
    files.delete(fileName)
  },
}
