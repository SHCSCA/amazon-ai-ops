import { createHash } from 'node:crypto';
import type { ReportParserDiagnostic } from './report-parser-diagnostics';
import { REPORT_PARSE_HARD_LIMITS, resolveReportResourceLimits, type ReportResourceLimits,
  type ParseOptions, type ParseKeywordMetricsOptions, type ParseListingContentOptions,
  type OwnerConfirmedFamilyScope, type FamilyReportLevel } from '@amazon-ai-ops/report-parser';

export interface ReportParserFile { bytes: Uint8Array; sourceName: string; sha256: string }
export type ReportParserTask =
  | { operation: 'report'; files: [ReportParserFile]; options?: ParseOptions }
  | { operation: 'control-totals'; files: [ReportParserFile]; window: { dateStart: string; dateEnd: string } }
  | { operation: 'preflight'; files: [ReportParserFile] }
  | { operation: 'keyword'; files: [ReportParserFile]; options?: ParseKeywordMetricsOptions }
  | { operation: 'listing'; files: [ReportParserFile]; options?: ParseListingContentOptions }
  | { operation: 'family'; files: ReportParserFile[]; scope: OwnerConfirmedFamilyScope; levels: FamilyReportLevel[] };
export interface ReportParserLimits {
  timeoutMs: number; shutdownTimeoutMs: number; heapMb: number; youngHeapMb: number; stackMb: number;
  maxResultBytes: number; maxQueueLength: number; maxAggregateInputBytes: number;
  maxResultDepth: number; maxResultNodes: number;
  maxMainInputBytes: number;
  resource: Readonly<ReportResourceLimits>;
}
export interface ReportParserRequest { protocol: 'report-parser/1'; nonce: string; task: ReportParserTask; limits: ReportParserLimits }
export interface ReportParserResponse { protocol: 'report-parser/1'; nonce: string; operation: ReportParserTask['operation'];
  hashes: string[]; payload?: string; error?: string; diagnostic?: ReportParserDiagnostic }
export const REPORT_WORKER_HARD_LIMITS = Object.freeze({ timeoutMs: 60_000, shutdownTimeoutMs: 10_000, heapMb: 512,
  youngHeapMb: 64, stackMb: 8, maxResultBytes: 32 * 1024 * 1024, maxQueueLength: 4, maxAggregateInputBytes: 100663296,
  maxResultDepth: 64, maxResultNodes: 4_000_000, maxMainInputBytes: 128 * 1024 * 1024 });
export const REPORT_WORKER_DEFAULT_LIMITS = Object.freeze({ timeoutMs: 30_000, shutdownTimeoutMs: 5_000, heapMb: 256,
  youngHeapMb: 32, stackMb: 4, maxResultBytes: 16 * 1024 * 1024, maxQueueLength: 4, maxAggregateInputBytes: 100663296,
  maxResultDepth: 32, maxResultNodes: 2_000_000, maxMainInputBytes: 128 * 1024 * 1024 });
export function reportBytesSha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
const REPORT_DATA_OBJECT_PROTOTYPE = Object.getPrototypeOf({});
function assertTaskData(root: unknown): void {
  const pending: Array<{ value: unknown; path: string }> = [{ value: root, path: '' }];
  let count = 0;
  while (pending.length) {
    const { value, path } = pending.pop()!;
    if (++count > 20_000) throw new Error('REPORT_PARSER_METADATA_LIMIT');
    if (value instanceof Uint8Array && /^files\.\d+\.bytes$/.test(path)) continue;
    if (value === null || value === undefined || ['string', 'boolean'].includes(typeof value)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) continue;
    if (!value || typeof value !== 'object' || ![REPORT_DATA_OBJECT_PROTOTYPE, null, Array.prototype].includes(Object.getPrototypeOf(value))) throw new Error('REPORT_PARSER_NON_DATA_REQUEST');
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error('REPORT_PARSER_NON_DATA_REQUEST');
      if (Array.isArray(value) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) throw new Error('REPORT_PARSER_NON_DATA_REQUEST');
      pending.push({ value: descriptor.value, path: path ? path + '.' + key : key });
    }
  }
}
export function captureReportParserLimits(read: (key: string) => string | null): ReportParserLimits {
  const take = (name: keyof typeof REPORT_WORKER_HARD_LIMITS) => {
    const value = read(`report_parser_${name}:v1`);
    const number = value === null ? REPORT_WORKER_DEFAULT_LIMITS[name] : Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > REPORT_WORKER_HARD_LIMITS[name]) throw new Error('REPORT_PARSER_CONFIGURATION_INVALID:' + name);
    return number;
  };
  const resource: Record<string, number> = {};
  for (const key of Object.keys(REPORT_PARSE_HARD_LIMITS) as Array<keyof ReportResourceLimits>) {
    const value = read(`report_parser_${key}:v1`);
    if (value !== null) resource[key] = Number(value);
  }
  return Object.freeze({ timeoutMs: take('timeoutMs'), shutdownTimeoutMs: take('shutdownTimeoutMs'),
    heapMb: take('heapMb'), youngHeapMb: take('youngHeapMb'), stackMb: take('stackMb'),
    maxQueueLength: take('maxQueueLength'), maxAggregateInputBytes: take('maxAggregateInputBytes'),
    maxResultDepth: take('maxResultDepth'), maxResultNodes: take('maxResultNodes'),
    maxMainInputBytes: take('maxMainInputBytes'),
    maxResultBytes: take('maxResultBytes'), resource: resolveReportResourceLimits(resource) });
}
export function assertReportParserRequest(request: ReportParserRequest): void {
  assertTaskData(request?.task);
  if (request?.protocol !== 'report-parser/1' || !/^[a-f0-9-]{36}$/.test(request.nonce)
    || !['report', 'control-totals', 'preflight', 'keyword', 'listing', 'family'].includes(request.task?.operation)) throw new Error('REPORT_PARSER_REQUEST_INVALID');
  for (const key of Object.keys(REPORT_WORKER_HARD_LIMITS) as Array<keyof typeof REPORT_WORKER_HARD_LIMITS>) {
    if (!Number.isSafeInteger(request.limits?.[key]) || request.limits[key] < 1 || request.limits[key] > REPORT_WORKER_HARD_LIMITS[key]) throw new Error('REPORT_PARSER_LIMIT_INVALID');
  }
  const limits = resolveReportResourceLimits(request.limits.resource);
  const files = request.task.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > (request.task.operation === 'family' ? 3 : 1)) throw new Error('REPORT_PARSER_FILE_COUNT_INVALID');
  let total = 0;
  for (const file of Array.from(files)) {
    if (!file || !(file.bytes instanceof Uint8Array) || file.bytes.byteLength < 1 || file.bytes.byteLength > limits.maxInputBytes
      || typeof file.sourceName !== 'string' || file.sourceName.length > 4096 || !/^[a-f0-9]{64}$/.test(file.sha256)
      || reportBytesSha256(file.bytes) !== file.sha256) throw new Error('REPORT_PARSER_FILE_INVALID');
    total += file.bytes.byteLength;
  }
  if (total > 3 * limits.maxInputBytes || total > request.limits.maxAggregateInputBytes) throw new Error('REPORT_PARSER_AGGREGATE_INPUT_LIMIT');
  // 选项仅为可克隆数据，映射路径不进入解析线程。
  if ('options' in request.task && request.task.options && 'fieldMappingsDir' in request.task.options) throw new Error('REPORT_PARSER_MAPPING_PATH_FORBIDDEN');
  const metadata = JSON.stringify({ ...request.task, files: files.map(({ sourceName, sha256 }) => ({ sourceName, sha256 })) });
  if (Buffer.byteLength(metadata) > 256 * 1024) throw new Error('REPORT_PARSER_METADATA_LIMIT');
}
