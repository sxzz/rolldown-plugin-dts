// Note: This file is only used during development and debugging.
// It is not included in the production build.

import { Buffer } from 'node:buffer'

export function printCodeWithSourceMap(code: string, result: any) {
  const codeWithMap = `\n\n${
    result.code
  }\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(
    JSON.stringify({
      ...result.map,
      sourcesContent: [code],
    }),
  ).toString('base64')}\n`

  console.info(codeWithMap)
}
