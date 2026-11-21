import path from 'node:path'
import { expect, test } from 'vitest'
import { LanguageContext } from '../../src/custom-language.ts'
import { createContext } from '../../src/tsc/context.ts'
import { tscEmit } from '../../src/tsc/index.ts'
import { fixture } from '../utils.ts'

function getLibFile(target: 'esnext' | 'es2015') {
  const id = fixture('basic.ts')
  const context = createContext()
  tscEmit({
    // Only the file and the lib under test, so programs are quick to create.
    tsconfigRaw: { compilerOptions: { target, lib: ['es5'], types: [] } },
    cwd: path.dirname(id),
    build: false,
    incremental: false,
    id,
    entries: [id],
    sourcemap: false,
    languageContext: new LanguageContext([]),
    context,
  })
  const [program] = context.programs
  return program
    .getSourceFiles()
    .find((file) => file.fileName.endsWith('/lib.es5.d.ts'))
}

test('shares lib files between programs', () => {
  const libFile = getLibFile('esnext')
  expect(libFile).toBeDefined()
  expect(getLibFile('esnext')).toBe(libFile)
  // `target` affects parsing, so the file is not shared.
  expect(getLibFile('es2015')).not.toBe(libFile)
})
