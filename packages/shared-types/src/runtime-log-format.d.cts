export type RuntimeLogLevel = 'info' | 'warn' | 'error';
export interface RuntimeLogRecord {
  timestamp: string;
  level: RuntimeLogLevel;
  event: string;
  context?: Record<string, unknown>;
}
export interface RuntimeLogPort {
  info(event: string, context?: Record<string, unknown>): void;
  warn(event: string, context?: Record<string, unknown>): void;
  error(event: string, context?: Record<string, unknown>): void;
}
export function sanitizeRuntimeLogValue(value: unknown, seen?: WeakSet<object>, depth?: number): unknown;
export function createRuntimeLogRecord(
  level: RuntimeLogLevel, event: string, context?: Record<string, unknown>, now?: Date,
): RuntimeLogRecord;
