import { createRuntimeLogRecord } from '@amazon-ai-ops/shared-types';
import { runtimeLogger } from './runtime-logger';

export function logReportParserFailure(event: string, first: unknown): unknown {
  const errors = [first];
  try { runtimeLogger.error(event, { error: first }); }
  catch (error) {
    errors.push(error);
    try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'report_parser.logger_failed')) + '\n'); }
    catch (fallbackError) { errors.push(fallbackError); }
  }
  return errors.length === 1 ? first : new AggregateError(errors, 'REPORT_PARSER_PRIMARY_AND_LOG_FAILURE');
}
