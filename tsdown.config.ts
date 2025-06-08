import { defineConfig } from 'tsdown'
import { dts } from './src/index.ts'

export default defineConfig({
  entry: ['./src/{index,filename}.ts', './src/tsc/worker.ts'],
  platform: 'node',
  dts: false,
  define: {
    'import.meta.WORKER_URL': JSON.stringify('./tsc/worker.js'),
  },
  plugins: [
    dts({
      isolatedDeclarations: true,
    }),
  ],
})
