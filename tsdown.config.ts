// import { dts } from './dist/index.js' // to test built version
import { DtsSnapshot } from 'rolldown-plugin-dts-snapshot'
import { RequireCJS } from 'rolldown-plugin-require-cjs'
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
    'import.meta.WORKER_URL': JSON.stringify('./tsc-worker.mjs'),
  },
  exports: true,
  treeshake: {
    moduleSideEffects: false,
  },
  external: ['@vue/language-core'],
  plugins: [
    dts({
      oxc: true,
    }),
    DtsSnapshot(),
    RequireCJS({
      shouldTransform(id) {
        // perf: TypeScript is large and takes time to detect ESM/CJS.
        if (id === 'typescript') return true
      },
      builtinNodeModules: true,
    }),
  ],
})
