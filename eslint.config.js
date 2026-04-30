import { sxzz } from '@sxzz/eslint-config'

export default sxzz({
  pnpm: true,
}).append({
  ignores: ['tests/rollup-plugin-dts/**', 'dts.snapshot.json'],
})
