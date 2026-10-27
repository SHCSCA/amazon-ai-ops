import { sanitizeRuntimeLogValue, type RuntimeLogLevel } from '@amazon-ai-ops/shared-types';

export const RENDERER_RUNTIME_LOG_CHANNEL = 'runtime:report-renderer-log';

export interface RendererRuntimeLogReport {
  level: RuntimeLogLevel;
  event: string;
  context?: Record<string, unknown>;
}

export function normalizeRendererRuntimeLogReport(value: unknown): RendererRuntimeLogReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('运行日志内容无效。');
  const input = value as Record<string, unknown>;
  if (!['info', 'warn', 'error'].includes(String(input.level))) throw new Error('运行日志级别无效。');
  if (typeof input.event !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(input.event)) throw new Error('运行日志事件无效。');
  if (input.context !== undefined && (!input.context || typeof input.context !== 'object' || Array.isArray(input.context))) {
    throw new Error('运行日志上下文无效。');
  }
  if (JSON.stringify(input.context)?.length > 64_000) throw new Error('运行日志内容超过上限。');
  const context = input.context === undefined ? undefined : sanitizeRuntimeLogValue(input.context) as Record<string, unknown>;
  if (JSON.stringify(context)?.length > 64_000) throw new Error('运行日志内容超过上限。');
  return { level: input.level as RuntimeLogLevel, event: input.event, ...(context ? { context } : {}) };
}
