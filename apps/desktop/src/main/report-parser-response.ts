import type { ReportParserRequest, ReportParserResponse } from './report-parser-worker-contracts';
import { assertReportParserDiagnostic, isReportParserErrorCode } from './report-parser-diagnostics';

function insist(value: unknown): asserts value { if (!value) throw new Error('REPORT_PARSER_RESULT_SCHEMA_INVALID'); }
function object(value: any): boolean { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fields(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
export function parseReportParserResponse(message: ReportParserResponse, request: ReportParserRequest): unknown {
  if (!object(message) || message.protocol !== request.protocol || message.nonce !== request.nonce
    || message.operation !== request.task.operation
    || !fields(message as unknown as Record<string, unknown>, ['protocol', 'nonce', 'operation', 'hashes', 'payload', 'error', 'diagnostic'])
    || JSON.stringify(message.hashes) !== JSON.stringify(request.task.files.map(file => file.sha256))) throw new Error('REPORT_PARSER_RESPONSE_BINDING_INVALID');
  if (message.error) {
    if (!isReportParserErrorCode(message.error)
      || message.payload !== undefined) throw new Error('REPORT_PARSER_ERROR_INVALID');
    assertReportParserDiagnostic(message.diagnostic);
    throw Object.assign(new Error(message.error), { diagnostic: message.diagnostic });
  }
  if (typeof message.payload !== 'string' || Buffer.byteLength(message.payload) > request.limits.maxResultBytes) throw new Error('REPORT_PARSER_RESULT_LIMIT');
  const result = JSON.parse(message.payload);
  const pending = [{ value: result, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++count > request.limits.maxResultNodes || depth > request.limits.maxResultDepth) throw new Error('REPORT_PARSER_RESULT_NODE_LIMIT');
    if (typeof value === 'number') insist(Number.isFinite(value));
    else if (value !== null && typeof value === 'object') for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
  }
  const maxRows = request.limits.resource.maxRows;
  switch (request.task.operation) {
    case 'report':
      insist(object(result) && fields(result, ['success', 'schemaValid', 'data', 'validation', 'sourceFile', 'parsedAt', 'totalRows', 'headers', 'templateRevision', 'templateError'])
        && typeof result.success === 'boolean' && typeof result.schemaValid === 'boolean'
        && Array.isArray(result.data) && result.data.length <= maxRows && result.data.every(object)
        && Number.isSafeInteger(result.totalRows) && result.totalRows >= 0 && result.totalRows <= maxRows
        && Array.isArray(result.headers) && result.headers.every((header: unknown) => typeof header === 'string')
        && result.sourceFile === request.task.files[0].sourceName && typeof result.parsedAt === 'string'
        && object(result.validation) && typeof result.validation.valid === 'boolean'
        && Array.isArray(result.validation.errors) && Number.isSafeInteger(result.validation.validCount)
        && Number.isSafeInteger(result.validation.invalidCount)
        && result.validation.validCount >= 0 && result.validation.validCount <= maxRows
        && result.validation.invalidCount >= 0 && result.validation.invalidCount <= maxRows
        && result.validation.errors.length <= maxRows && result.headers.length <= request.limits.resource.maxColumns);
      break;
    case 'control-totals':
      insist(object(result) && fields(result, ['expectedRows', 'expectedCost']) && Number.isSafeInteger(result.expectedRows) && result.expectedRows >= 0
        && result.expectedRows <= maxRows && Number.isFinite(result.expectedCost));
      break;
    case 'preflight':
      insist(Array.isArray(result) && result.length <= 12
        && result.every(row => Array.isArray(row) && row.length <= request.limits.resource.maxColumns
          && row.every(cell => cell === null || ['string', 'number', 'boolean'].includes(typeof cell))));
      break;
    case 'family':
      insist(object(result) && fields(result, ['schemaVersion', 'provenanceLabel', 'familyLabel', 'confirmationReference', 'bindings', 'consumedHashes',
        'completeness', 'authority', 'nativeAsinAuthority', 'formalEligibility', 'currency', 'attributionWindow', 'keywordCoverage', 'days'])
        && result.schemaVersion === 1 && result.provenanceLabel === 'user_confirmed_scope'
        && result.completeness === 'partial-observation' && result.authority === 'campaign-only'
        && result.nativeAsinAuthority === false && result.formalEligibility === false
        && Array.isArray(result.days) && result.days.length <= 366 && Array.isArray(result.bindings)
        && result.bindings.length <= 32 && Array.isArray(result.consumedHashes) && result.consumedHashes.length <= 3);
      break;
    case 'keyword': insist(object(result) && fields(result, ['metrics', 'diagnostics']) && Array.isArray(result.metrics) && result.metrics.length <= maxRows
      && result.metrics.every(object) && object(result.diagnostics)); break;
    case 'listing': insist(object(result) && fields(result, ['asin', 'title', 'bullets', 'aPlus', 'imageCopy', 'backendTerms'])
      && typeof result.asin === 'string' && typeof result.title === 'string'
      && Array.isArray(result.bullets) && result.bullets.every((value: unknown) => typeof value === 'string')); break;
  }
  return result;
}
