// Note: This file is only used during development and debugging.
// It is not included in the production build.

import { Buffer } from 'node:buffer'

/**
 * Prints the generated code with an inlined base64 source map URL so it can
 * be inspected directly in a browser's DevTools source panel.
 *
 * @param code - The original source code (used as `sourcesContent`).
 * @param result - An object with `code` and `map` fields from the transformer.
 */
export function printCodeWithSourceMap(code: string, result: any): void {
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
