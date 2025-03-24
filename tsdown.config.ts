import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  target: 'node20.18',
  clean: true,
  dts: true,
  platform: 'node',
})
