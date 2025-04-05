# rolldown-plugin-dts [![npm](https://img.shields.io/npm/v/rolldown-plugin-dts.svg)](https://npmjs.com/package/rolldown-plugin-dts)

[![Unit Test](https://github.com/sxzz/rolldown-plugin-dts/actions/workflows/unit-test.yml/badge.svg)](https://github.com/sxzz/rolldown-plugin-dts/actions/workflows/unit-test.yml)

A Rolldown plugin to bundle dts files.

## Install

```bash
npm i rolldown-plugin-dts
```

## Usage

Add the plugin to your `rolldown.config.js`:

```js
// rolldown.config.js
import { dts } from 'rolldown-plugin-dts'

const config = [
  {
    input: './index.d.ts',
    plugins: [dts()],
    output: [
      {
        file: 'dist/index.d.ts',
        format: 'es',
      },
    ],
  },
]

export default config
```

> [!NOTE]
> Namespaces are not supported yet.

## Credits

The project is inspired by [rollup-plugin-dts](https://github.com/Swatinem/rollup-plugin-dts)
but has been independently implemented.
We extend our gratitude to the original creators for their contributions.
Furthermore, the test suite is authorized by them and distributed under the MIT license.

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/sxzz/sponsors/sponsors.svg">
    <img src='https://cdn.jsdelivr.net/gh/sxzz/sponsors/sponsors.svg'/>
  </a>
</p>

## License

[MIT](./LICENSE) License © 2025 [三咲智子 Kevin Deng](https://github.com/sxzz)
