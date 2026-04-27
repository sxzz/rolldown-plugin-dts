// import { dts } from './dist/index.js' // to test built version
import { RequireCJS } from 'rolldown-plugin-require-cjs'
import { defineConfig } from 'tsdown'
import ApiSnapshot from 'tsnapi/rolldown'
import { dts } from './src/index.ts'

export default defineConfig({
  entry: {
    index: './src/index.ts',
    internal: './src/internal.ts',
    tsc: './src/tsc/index.ts',
    'tsc-context': './src/tsc/context.ts',
    'tsc-worker': './src/tsc/worker.ts',
  },
  platform: 'node',
  dts: false,
  define: {
    'import.meta.WORKER_URL': JSON.stringify('./tsc-worker.mjs'),
  },
  deps: {
    onlyBundle: [],
  },
  treeshake: {
    moduleSideEffects: false,
  },
  exports: true,
  plugins: [
    dts({
      oxc: true,
    }),
    ApiSnapshot(),
    RequireCJS({
      shouldTransform(id) {
        // perf: TypeScript is large and takes time to detect ESM/CJS.
        if (id === 'typescript') return true
      },
    }),
  ],
})
