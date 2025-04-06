import type { MagicString } from 'magic-string-ast'

export type Range = [start: number, end: number]

export function overwriteOrAppend(
  s: MagicString,
  range: Range,
  replacement: string,
  suffix?: string,
): void {
  if (range[0] === range[1]) {
    s.appendLeft(range[0], ` ${replacement}`)
    return
  }

  const original = s.slice(range[0], range[1])
  if (original !== replacement) {
    s.overwrite(range[0], range[1], replacement + (suffix || ''))
  }
}
