import { parentPort, workerData } from 'node:worker_threads';
import { parseReportBytes, readRawControlTotalsBytes, readReportHeaderRowsBytes,
  parseKeywordMetricsBytes, parseListingContentBytes, observeOwnerConfirmedFamily } from '@amazon-ai-ops/report-parser';
import { assertReportParserRequest, type ReportParserRequest, type ReportParserResponse } from './report-parser-worker-contracts';
import { reportParserDiagnostic } from './report-parser-diagnostics';
import { stringifyBoundedReportResult } from './report-parser-json-budget';

function execute(request: ReportParserRequest): unknown {
  assertReportParserRequest(request);
  const task = request.task, file = task.files[0], resource = { limits: request.limits.resource };
  switch (task.operation) {
    case 'report': return parseReportBytes(file.bytes, file.sourceName, task.options, resource);
    case 'control-totals': return readRawControlTotalsBytes(file.bytes, file.sourceName, task.window, resource);
    case 'preflight': return readReportHeaderRowsBytes(file.bytes, file.sourceName, resource);
    case 'keyword': return parseKeywordMetricsBytes(file.bytes, file.sourceName, task.options, resource);
    case 'listing': return parseListingContentBytes(file.bytes, file.sourceName, task.options, resource);
    case 'family':
      if (task.levels.length !== task.files.length) throw new Error('REPORT_PARSER_FAMILY_LEVELS_INVALID');
      return observeOwnerConfirmedFamily(task.scope, task.files.map((file, index) => ({ bytes: file.bytes, reportType: task.levels[index] })), resource);
  }
}
try {
  const request = workerData as ReportParserRequest;
  const result = execute(request);
  const payload = stringifyBoundedReportResult(result, request.limits);
  const response: ReportParserResponse = { protocol: 'report-parser/1', nonce: request.nonce, operation: request.task.operation,
    hashes: request.task.files.map(file => file.sha256), payload };
  parentPort?.postMessage(response);
} catch (error) {
  const request = workerData as Partial<ReportParserRequest>;
  const diagnostic = reportParserDiagnostic(error, request?.task?.operation ?? 'parse');
  // 仅保留安全码、阶段及无路径栈帧；聚合异常的首错与次错按原顺序投影。
  parentPort?.postMessage({ protocol: 'report-parser/1', nonce: request?.nonce, operation: request?.task?.operation,
    hashes: request?.task?.files?.map(file => file.sha256), error: diagnostic.code, diagnostic });
}
