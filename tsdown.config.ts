import { defineConfig } from 'tsdown'
import { dts } from './src/index.ts'

export default defineConfig({
  entry: {
    index: './src/index.ts',
    filename: './src/filename.ts',
    tsc: './src/tsc/index.ts',
    'tsc-context': './src/tsc/context.ts',
    'tsc-worker': './src/tsc/worker.ts',
  },
  platform: 'node',
  dts: false,
  define: {
    'import.meta.WORKER_URL': JSON.stringify('./tsc-worker.js'),
  },
  exports: true,
  plugins: [
    dts({
      oxc: true,
    }),
  ],
})
