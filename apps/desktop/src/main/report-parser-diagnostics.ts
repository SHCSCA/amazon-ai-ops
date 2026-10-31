export interface ReportParserDiagnostic {
  name: string; code: string; stage: string; frames: string[]; secondary: ReportParserDiagnostic[];
}
const names = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AggregateError', 'ReportResourceError']);
const codes = new Set(['REPORT_PARSER_FAILED', 'ERR_WORKER_OUT_OF_MEMORY', 'REPORT_RESOURCE_LIMIT', 'REPORT_ARCHIVE_INVALID',
  'REPORT_FORMAT_UNSUPPORTED', 'REPORT_PARSE_OPTIONS_INVALID', 'REPORT_PARSE_FAILED', 'REPORT_SOURCE_CHANGED', 'REPORT_SOURCE_READ_FAILED',
  'REPORT_TEMPLATE_AMBIGUOUS', 'REPORT_TEMPLATE_CURRENCY', 'REPORT_TEMPLATE_TYPE_MISMATCH', 'REPORT_TEMPLATE_UNKNOWN',
  'REPORT_PARSER_AGGREGATE_INPUT_LIMIT', 'REPORT_PARSER_CONFIGURATION_INVALID', 'REPORT_PARSER_FAMILY_LEVELS_INVALID',
  'REPORT_PARSER_FILE_COUNT_INVALID', 'REPORT_PARSER_FILE_INVALID', 'REPORT_PARSER_LIMIT_INVALID', 'REPORT_PARSER_MAPPING_PATH_FORBIDDEN',
  'REPORT_PARSER_METADATA_LIMIT', 'REPORT_PARSER_NON_DATA_REQUEST', 'REPORT_PARSER_REQUEST_INVALID',
  'REPORT_PARSER_RESULT_ENCODING_MISMATCH', 'REPORT_PARSER_RESULT_INVALID', 'REPORT_PARSER_RESULT_LIMIT']);
export function isReportParserErrorCode(value: unknown): value is string { return typeof value === 'string' && codes.has(value); }
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
export function reportParserDiagnostic(error: unknown, stage: string, depth = 0): ReportParserDiagnostic {
  const name = own(error, 'name') ?? (error instanceof Error ? error.name : undefined);
  const candidate = own(error, 'code') ?? (typeof own(error, 'message') === 'string' ? String(own(error, 'message')).split(':')[0] : undefined);
  const code = isReportParserErrorCode(candidate) ? candidate : 'REPORT_PARSER_FAILED';
  const declaredStage = own(error, 'stage');
  const safeStage = typeof declaredStage === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(declaredStage) ? declaredStage : stage;
  const stack = own(error, 'stack');
  const frames = typeof stack === 'string' ? stack.split('\n').slice(1, 9).flatMap(line => {
    const match = line.match(/^\s*at\s+(?:async\s+)?([A-Za-z0-9_.$<>]+).*?:(\d+):(\d+)\)?$/);
    return match ? [`${match[1].slice(0, 80)}:${match[2]}:${match[3]}`] : [];
  }) : [];
  const errors = own(error, 'errors');
  const secondary = depth < 2 && Array.isArray(errors) ? errors.slice(0, 4).map(child => reportParserDiagnostic(child, safeStage, depth + 1)) : [];
  return { name: typeof name === 'string' && names.has(name) ? name : 'Error', code,
    stage: /^[a-z][a-z0-9-]{0,63}$/.test(safeStage) ? safeStage : 'parse', frames, secondary };
}
export function assertReportParserDiagnostic(value: unknown, depth = 0): asserts value is ReportParserDiagnostic {
  const row = value as ReportParserDiagnostic;
  if (!row || typeof row !== 'object' || Array.isArray(row) || !names.has(row.name)
    || !isReportParserErrorCode(row.code) || !/^[a-z][a-z0-9-]{0,63}$/.test(row.stage)
    || !Array.isArray(row.frames) || row.frames.length > 8
    || !row.frames.every(frame => typeof frame === 'string' && /^[A-Za-z0-9_.$<>]{1,80}:\d+:\d+$/.test(frame))
    || !Array.isArray(row.secondary) || row.secondary.length > 4 || depth > 2
    || Object.keys(row).some(key => !['name', 'code', 'stage', 'frames', 'secondary'].includes(key))) throw new Error('REPORT_PARSER_DIAGNOSTIC_INVALID');
  for (const child of row.secondary) assertReportParserDiagnostic(child, depth + 1);
}
