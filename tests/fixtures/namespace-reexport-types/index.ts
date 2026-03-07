// Simulates the pino pattern:
// 1. Import * as from a module
// 2. Re-export types inside a namespace via type aliases

import * as serializers from 'mock-serializers'

// Module-level function that uses the imported types
export function formatError(err: Error): serializers.SerializedError {
  return serializers.err(err)
}

// Namespace that re-exports types (like pino does with pino-std-serializers)
export namespace logger {
  // These become `export type X = serializers.X` after bundling
  // which should be converted to `export { type X }` since X exists at module level
  export type SerializedError = serializers.SerializedError
  export type SerializedRequest = serializers.SerializedRequest
  export type SerializedResponse = serializers.SerializedResponse

  // Value export that references the namespace
  export const stdSerializers: typeof serializers = serializers
}
