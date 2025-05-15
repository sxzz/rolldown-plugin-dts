import { defineConfig } from 'tsdown'
import { dts } from './src/index.ts'

export default defineConfig({
  entry: ['./src/index.ts', './src/utils/tsc-worker.ts'],
  target: 'node20.18',
  platform: 'node',
  dts: false,
  define: {
    'import.meta.WORKER_URL': JSON.stringify('./utils/tsc-worker.js'),
  },
  plugins: [
    dts({
      isolatedDeclarations: true,
    }),
  ],
})
