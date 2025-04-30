import { defineConfig } from 'tsdown'
import { dts } from './src/index'

export default defineConfig({
  entry: ['./src/index.ts'],
  target: 'node20.18',
  platform: 'node',
  dts: false,
  plugins: [
    dts({
      isolatedDeclarations: true,
    }),
  ],
})
