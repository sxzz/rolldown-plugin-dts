// Based on https://github.com/sindresorhus/escape-string-regexp
export function escapeRegExp(value: string): string {
  return value
    .replaceAll(/[|\\{}()[\]^$+*?.]/g, String.raw`\$&`)
    .replaceAll('-', String.raw`\x2d`)
}
