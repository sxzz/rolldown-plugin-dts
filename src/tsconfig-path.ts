import { realpathSync } from 'node:fs'
import path from 'node:path'

// Preserve a config-file symlink's include base, but make directory aliases
// agree with the physical module IDs supplied by Rolldown.
export function canonicalTsconfigPath(filename: string): string {
  const absolute = path.resolve(filename)
  return path.join(
    realpathSync(path.dirname(absolute)),
    path.basename(absolute),
  )
}
