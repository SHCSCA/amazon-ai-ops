import { createRuntimeLogRecord, type RuntimeLogPort } from '@amazon-ai-ops/shared-types';

export const REPORT_PARSE_HARD_LIMITS = Object.freeze({
  maxInputBytes: 32 * 1024 * 1024, maxZipEntries: 512,
  maxZipEntryBytes: 32 * 1024 * 1024, maxZipTotalBytes: 128 * 1024 * 1024,
  maxZipPathBytes: 512, maxZipPathDepth: 16, maxZipDirectoryNodes: 1024,
  maxNormalizedZipBytes: 136 * 1024 * 1024,
  maxZipExpansionRatio: 200, maxSheets: 16, maxRows: 100_012, maxColumns: 256,
  maxRangeCells: 2_000_000, maxCells: 2_000_000, maxCellTextChars: 32_767,
  maxTextBytes: 32 * 1024 * 1024, maxXmlDepth: 64, maxXmlAttributes: 64, maxXmlTokens: 12_000_000,
});
export type ReportResourceLimits = { readonly [Key in keyof typeof REPORT_PARSE_HARD_LIMITS]: number };
export interface ReportResourceOptions {
  readonly limits?: Partial<ReportResourceLimits>;
  readonly logger?: Pick<RuntimeLogPort, 'warn' | 'error'>;
}
export class ReportResourceError extends Error {
  constructor(readonly code: string, readonly stage: string) {
    super(`${code}: 报表超出安全解析容量或结构不受支持，请缩小导出范围并重新导出。`);
    this.name = 'ReportResourceError';
  }
}
export function rejectReport(stage: string, code = 'REPORT_RESOURCE_LIMIT'): never {
  throw new ReportResourceError(code, stage);
}
export function resolveReportResourceLimits(input: Partial<ReportResourceLimits> = {}): ReportResourceLimits {
  if (!input || typeof input !== 'object' || ![Object.getPrototypeOf({}), null].includes(Object.getPrototypeOf(input))) rejectReport('policy');
  const result = { ...REPORT_PARSE_HARD_LIMITS } as Record<string, number>;
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(REPORT_PARSE_HARD_LIMITS, key)) rejectReport('policy');
    const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
    if (!('value' in descriptor)) rejectReport('policy');
    const value: unknown = descriptor.value;
    const maximum = REPORT_PARSE_HARD_LIMITS[key as keyof ReportResourceLimits];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) rejectReport('policy');
    result[key] = value;
  }
  return Object.freeze(result) as ReportResourceLimits;
}
export function reportResourceBoundary<T>(resource: ReportResourceOptions, operation: () => T): T {
  try { return operation(); }
  catch (error) {
    const context = error instanceof ReportResourceError
      ? { code: error.code, stage: error.stage } : { code: 'REPORT_PARSE_FAILED', stage: 'parse' };
    try {
      if (resource.logger) resource.logger.error('report.parse_rejected', context);
      else console.error(JSON.stringify(createRuntimeLogRecord('error', 'report.parse_rejected', context)));
    } catch (loggingError) {
      const errors = [error, loggingError];
      try { console.error(JSON.stringify(createRuntimeLogRecord('error', 'report.logging_failed', context))); }
      catch (fallbackError) { errors.push(fallbackError); }
      const failure = new AggregateError(errors, error instanceof Error ? error.message : 'REPORT_PARSE_FAILED', { cause: error });
      Object.assign(failure, context);
      throw failure;
    }
    throw error;
  }
}
export function checkReportInput(bytes: Uint8Array, limits: ReportResourceLimits): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > limits.maxInputBytes) rejectReport('input-bytes');
}
