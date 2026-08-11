import { EventEmitter } from 'node:events'
import { beforeEach, expect, test, vi } from 'vitest'
import { runTsgo } from '../src/tsgo.ts'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  mkdtemp: vi.fn(),
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs/promises', () => ({
  mkdtemp: mocks.mkdtemp,
  rm: vi.fn(),
}))

beforeEach(() => {
  mocks.spawn.mockReset()
  mocks.mkdtemp.mockResolvedValue('/tmp/rolldown-plugin-dts-test')
})

test.each([
  [23, null, 'tsgo process exited with code 23'],
  [null, 'SIGTERM', 'tsgo process terminated by signal SIGTERM'],
] as const)('preserves tsgo close status', async (code, signal, message) => {
  // ChildProcess uses EventEmitter and emits both close values as arguments.
  // eslint-disable-next-line unicorn/prefer-event-target
  const child = new EventEmitter()
  mocks.spawn.mockReturnValue(child)

  const result = runTsgo('tsgo', '/project', '/project/tsconfig.json')
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce())
  child.emit('close', code, signal)

  await expect(result).rejects.toThrow(message)
})
