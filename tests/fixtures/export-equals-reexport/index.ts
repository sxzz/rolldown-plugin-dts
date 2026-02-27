// Test case: imports from a module that re-exports types from an export = namespace module
// This simulates the fastify -> pino pattern

import type {
  FrameworkLogger,
  FrameworkLogFn,
  LogLevel,
  Bindings,
} from 'mock-framework'

export interface AppLogger {
  logger: FrameworkLogger
}

export class LoggerService {
  private logger: FrameworkLogger
  private level: LogLevel

  constructor(logger: FrameworkLogger) {
    this.logger = logger
    this.level = logger.level
  }

  log(fn: FrameworkLogFn, msg: string): void {
    fn(msg)
  }

  withBindings(bindings: Bindings): FrameworkLogger {
    return this.logger.child(bindings)
  }

  getLevel(): LogLevel {
    return this.level
  }
}

export type { FrameworkLogger, FrameworkLogFn, LogLevel }
