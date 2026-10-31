import * as path from 'node:path';
import type { ParseOptions, ParseResult, LingxingRawReportControlTotals, OwnerConfirmedFamilyScope,
  FamilyReportBytes, FamilyObservation, KeywordMetricParseResult, ParseKeywordMetricsOptions,
  ParseListingContentOptions } from '@amazon-ai-ops/report-parser';
import type { ListingContent } from '@amazon-ai-ops/shared-types';
import type { ConfigurationBus } from './configuration-bus';
import { runtimeLogger } from './runtime-logger';
import { createReportParserWorkerClient } from './report-parser-worker-client';
import { captureReportParserLimits, REPORT_WORKER_DEFAULT_LIMITS, reportBytesSha256, type ReportParserFile } from './report-parser-worker-contracts';
import { captureReportSource, assertReportSourceCurrent, type ReportSourceSnapshot } from './report-parser-source';
import { logReportParserFailure } from './report-parser-errors';

export function createReportParserRuntime(options: { mainModulePath: string; getConfigurationBus: () => Pick<ConfigurationBus, 'get'> | null }) {
  const client = createReportParserWorkerClient({ workerPath: path.join(path.dirname(options.mainModulePath), 'report-parser-worker.cjs'), logger: runtimeLogger });
  let heldInputBytes = 0, stopping = false, shutdownTimeoutMs: number = REPORT_WORKER_DEFAULT_LIMITS.shutdownTimeoutMs;
  const leases = new Map<ReportSourceSnapshot, () => void>();
  const idle = new Set<() => void>();
  function createSession() {
    const bus = options.getConfigurationBus();
    if (!bus) throw new Error('REPORT_PARSER_CONFIGURATION_BUS_REQUIRED');
    const limits = captureReportParserLimits(key => bus.get(key));
    shutdownTimeoutMs = limits.shutdownTimeoutMs;
    const reserveInputBytes = (bytes: number): (() => void) => {
      if (stopping || !Number.isSafeInteger(bytes) || bytes < 1 || heldInputBytes + bytes > limits.maxMainInputBytes)
        throw logReportParserFailure('report_parser.input_budget_rejected', new Error('REPORT_PARSER_MAIN_INPUT_LIMIT'));
      heldInputBytes += bytes;
      let released = false;
      return () => {
        if (released) return;
        released = true; heldInputBytes -= bytes;
        if (!heldInputBytes) for (const done of idle) done();
      };
    };
    const read = (source: string) => {
      const release = reserveInputBytes(limits.resource.maxInputBytes);
      try { const snapshot = captureReportSource(source, limits.resource.maxInputBytes); leases.set(snapshot, release); return snapshot; }
      catch (error) { release(); throw error; }
    };
    const release = (snapshot: ReportSourceSnapshot) => {
      const held = leases.get(snapshot);
      if (held) { leases.delete(snapshot); snapshot.bytes = new Uint8Array(); held(); }
    };
    const file = (snapshot: ReportSourceSnapshot): ReportParserFile => ({ bytes: snapshot.bytes, sourceName: snapshot.sourceName, sha256: snapshot.sha256 });
    return {
      maxAggregateResultBytes: limits.maxResultBytes,
      maxInputBytes: limits.resource.maxInputBytes,
      reserveInputBytes, read, release,
      assertCurrent: (snapshot: ReportSourceSnapshot) => assertReportSourceCurrent(snapshot, limits.resource.maxInputBytes),
      parse: (snapshot: ReportSourceSnapshot, parseOptions?: ParseOptions, signal?: AbortSignal) =>
        client.execute<ParseResult>({ operation: 'report', files: [file(snapshot)], options: parseOptions }, limits, signal),
      controlTotals: (snapshot: ReportSourceSnapshot, window: { dateStart: string; dateEnd: string }, signal?: AbortSignal) =>
        client.execute<LingxingRawReportControlTotals>({ operation: 'control-totals', files: [file(snapshot)], window }, limits, signal),
      preflight: async (source: string, signal?: AbortSignal): Promise<unknown[][]> => {
        const snapshot = read(source);
        try {
          const result = await client.execute<unknown[][]>({ operation: 'preflight', files: [file(snapshot)] }, limits, signal);
          assertReportSourceCurrent(snapshot, limits.resource.maxInputBytes); return result;
        } finally { release(snapshot); }
      },
      family: (scope: OwnerConfirmedFamilyScope, reports: FamilyReportBytes[], signal?: AbortSignal) =>
        client.execute<FamilyObservation>({ operation: 'family', scope, levels: reports.map(report => report.reportType),
          files: reports.map(report => ({ bytes: report.bytes, sourceName: 'confirmed.xlsx', sha256: reportBytesSha256(report.bytes) })) }, limits, signal),
      keyword: (snapshot: ReportSourceSnapshot, parseOptions: ParseKeywordMetricsOptions, signal?: AbortSignal) =>
        client.execute<KeywordMetricParseResult>({ operation: 'keyword', files: [file(snapshot)], options: parseOptions }, limits, signal),
      listing: (snapshot: ReportSourceSnapshot, parseOptions: ParseListingContentOptions, signal?: AbortSignal) =>
        client.execute<ListingContent>({ operation: 'listing', files: [file(snapshot)], options: parseOptions }, limits, signal),
    };
  }
  async function stopAndDrain() {
    stopping = true;
    await client.stopAndDrain();
    if (!heldInputBytes) return;
    let timer: ReturnType<typeof setTimeout> | undefined, done: () => void = () => {};
    try { await new Promise<void>((resolve, reject) => {
      done = resolve; idle.add(done);
      timer = setTimeout(() => reject(new Error('REPORT_PARSER_INPUT_DRAIN_TIMEOUT')), shutdownTimeoutMs);
    }); } catch (error) { throw logReportParserFailure('report_parser.input_drain_failed', error); }
    finally { idle.delete(done); if (timer) clearTimeout(timer); }
  }
  return { createSession, stopAndDrain };
}
export type ReportParserSession = ReturnType<ReturnType<typeof createReportParserRuntime>['createSession']>;
