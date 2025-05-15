import { defineConfig } from 'tsdown'
import { dts } from './src/index.ts'

export default defineConfig({
  entry: ['./src/index.ts', './src/utils/tsc.ts'],
  target: 'node20.18',
  platform: 'node',
  dts: false,
  plugins: [
    dts({
      compilerOptions: {
        isolatedDeclarations: false,
      },
      // isolatedDeclarations: true,
    }),
  ],
})
