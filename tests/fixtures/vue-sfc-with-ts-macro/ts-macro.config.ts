export default {
  plugins: [
    {
      name: 'define-style',
      resolveVirtualCode({ codes }) {
        codes.push(`declare function defineStyle(style: string)`)
      },
    },
  ],
}
