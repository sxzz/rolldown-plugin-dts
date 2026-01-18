import { spawnSync } from 'node:child_process'

/**
 * Find an executable in PATH using `which` (Unix) or `where` (Windows).
 * @returns The path to the executable, or undefined if not found.
 */
export function which(command: string): string | undefined {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [
    command,
  ])
  if (result.status === 0) {
    return result.stdout.toString().trim().split('\n')[0]
  }
  return undefined
}
