import { defineConfig } from 'rolldown'
import { dependencies } from './package.json'
import { dts } from './src/index'

const common = defineConfig({
  input: ['./src/index.ts', './src/generate.ts'],
  external: Object.keys(dependencies),
  platform: 'node',
})

const config = defineConfig([
  {
    ...common,
    plugins: [dts()],
    output: {
      dir: 'temp/esm',
      format: 'es',
      entryFileNames: '[name].mjs',
      chunkFileNames: '[name]-[hash].mjs',
    },
  },
  {
    ...common,
    output: {
      dir: 'temp/cjs',
      format: 'cjs',
      entryFileNames: '[name].cjs',
      chunkFileNames: '[name]-[hash].cjs',
    },
  },
  {
    ...common,
    plugins: [dts({ emitDtsOnly: true })],
    output: {
      dir: 'temp/cjs',
      format: 'esm',
      entryFileNames: '[name].cjs',
      chunkFileNames: '[name]-[hash].cjs',
    },
  },
])

export default config
