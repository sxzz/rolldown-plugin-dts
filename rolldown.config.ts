import { defineConfig } from 'rolldown'
import { dependencies } from './package.json'
import { dts } from './src/index'

export default defineConfig({
  input: ['./src/index.ts', './src/generate.ts'],
  external: Object.keys(dependencies),
  platform: 'node',
  plugins: [dts()],
  output: {
    dir: 'temp',
    format: 'es',
    entryFileNames: '[name].mjs',
    chunkFileNames: '[name]-[hash].mjs',
  },
})
