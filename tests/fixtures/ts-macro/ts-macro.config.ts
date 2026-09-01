import { defineConfig } from 'ts-macro'

export default defineConfig({
  plugins: [
    {
      name: 'define-style',
      resolveVirtualCode({ codes }) {
        codes.push(`declare function defineStyle(style: string): string`)
      },
    },
  ],
})
