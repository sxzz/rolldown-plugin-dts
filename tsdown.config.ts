// import { dts } from './dist/index.js' // to test built version
import { defineConfig } from 'tsdown'
import ApiSnapshot from 'tsnapi/rolldown'
import { dts, type Options } from './src/index.ts'

export default defineConfig((cli) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const cliDts = { ...(typeof cli.dts === 'object' ? cli.dts : {}) } as Options
  cli.dts = false

  return {
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
      'import.meta.TEST': 'false',
    },
    deps: {
      neverBundle: ['@vue/language-core'],
      onlyBundle: [],
    },
    treeshake: {
      moduleSideEffects: false,
    },
    exports: true,
    plugins: [
      dts({
        generator: 'oxc',
        ...cliDts,
      }),
      ApiSnapshot(),
    ],
  }
})
