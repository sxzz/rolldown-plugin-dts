import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import { rolldown } from 'rolldown'
import { dts } from '../../../src/index.ts'

readline.createInterface({ input: process.stdin })

const bundle = await rolldown({
  input: path.resolve(import.meta.dirname, '../basic.ts'),
  plugins: [dts({ generator: 'tsc', tsc: { parallel: true } })],
})
await bundle.generate()
process.exit(0)
