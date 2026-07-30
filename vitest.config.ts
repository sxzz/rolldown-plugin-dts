import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    'import.meta.TEST': 'true',
  },
  test: {
    testTimeout: 10_000,
  },
  server: {
    watch: {
      ignored: ['**/temp/**'],
    },
  },
})
