import { depth as otherDepth, width as otherWidth } from './dep'
export declare const [width, , ...rest]: [number, string, ...boolean[]]
export declare const {
  depth,
  nested: { inner },
  ...others
}: { depth: number; nested: { inner: string }; x: 1 }
export declare const all: [
  typeof width,
  typeof otherWidth,
  typeof depth,
  typeof otherDepth,
]
export { depth as depDepth, width as depWidth } from './dep'
