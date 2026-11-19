import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    'import.meta.TEST': 'true',
  },
  test: {
    testTimeout: 10_000,
    // Logs from passing tests are noise; failing tests still print theirs.
    silent: 'passed-only',
  },
  server: {
    watch: {
      ignored: ['**/temp/**'],
    },
  },
})
