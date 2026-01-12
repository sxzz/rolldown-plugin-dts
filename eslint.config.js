import { sxzz } from '@sxzz/eslint-config'

export default sxzz().append({
  ignores: ['tests/rollup-plugin-dts/**', 'dts.snapshot.json'],
})
