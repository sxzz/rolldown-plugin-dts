import { expect, test } from 'vitest'
import { which } from '../src/utils.ts'

test('which finds existing command', () => {
  // node should always exist in the test environment
  const nodePath = which('node')
  expect(nodePath).toBeDefined()
  expect(nodePath).toContain('node')
})

test('which returns undefined for non-existent command', () => {
  const result = which('this-command-does-not-exist-12345')
  expect(result).toBeUndefined()
})
