import { defineConfig } from 'rolldown'
import { dependencies } from './package.json'
import { dts } from './src/index'

const config = defineConfig({
  input: './src/index.ts',
  plugins: [dts()],
  external: Object.keys(dependencies),
  platform: 'node',
  output: [{ dir: 'temp', format: 'es' }],
})

export default config
