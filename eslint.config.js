import { sxzz } from '@sxzz/eslint-config'

export default sxzz({
  pnpm: true,
}).append({
  ignores: [
    'tests/rollup-plugin-dts/**',
    'dts.snapshot.json',
    // the fake JS snippets are pseudo code, not valid JavaScript
    'src/fake-js/README.md/**',
  ],
})
