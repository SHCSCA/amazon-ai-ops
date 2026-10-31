import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { createRuntimeLogRecord } from '@amazon-ai-ops/shared-types';
import type { RuntimeLogPort } from './runtime-logger';
import { assertReportParserRequest, REPORT_WORKER_DEFAULT_LIMITS, type ReportParserLimits,
  type ReportParserTask, type ReportParserRequest, type ReportParserResponse } from './report-parser-worker-contracts';
import { parseReportParserResponse } from './report-parser-response';

export interface ParserWorkerLike {
  once(event: string, listener: (...values: any[]) => void): unknown;
  on(event: string, listener: (...values: any[]) => void): unknown;
  terminate(): Promise<number>;
}
export interface ReportParserWorkerClientOptions {
  workerPath: string;
  logger: Pick<RuntimeLogPort, 'error'>;
  createWorker?: (request: ReportParserRequest) => ParserWorkerLike;
}
interface QueuedRequest {
  request: ReportParserRequest; bytes: number; deadline: number; signal?: AbortSignal;
  resolve: (result: unknown) => void; reject: (error: unknown) => void; dequeueAbort: () => void;
  queueTimer?: ReturnType<typeof setTimeout>;
}
export function createReportParserWorkerClient(options: ReportParserWorkerClientOptions) {
  const active = new Map<ParserWorkerLike, { exited: Promise<void>; cancel: () => void }>();
  const queue: QueuedRequest[] = [];
  let stopping = false, heldBytes = 0;
  let shutdownTimeoutMs = REPORT_WORKER_DEFAULT_LIMITS.shutdownTimeoutMs as number;
  const safeLog = (event: string, context: Record<string, unknown>, secondary: unknown[]) => {
    try { options.logger.error(event, context); }
    catch (error) {
      secondary.push(error);
      try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'report_parser.logger_failed')) + '\n'); }
      catch (fallbackError) { secondary.push(fallbackError); }
    }
  };
  const errorWithSecondary = (first: unknown, secondary: unknown[]) => secondary.length
    ? new AggregateError([first, ...secondary], 'REPORT_PARSER_PRIMARY_AND_SECONDARY_FAILURE') : first;
  const spawn = options.createWorker ?? (request => new Worker(options.workerPath, {
    workerData: request, transferList: request.task.files.map(file => file.bytes.buffer as ArrayBuffer),
    resourceLimits: { maxOldGenerationSizeMb: request.limits.heapMb,
      maxYoungGenerationSizeMb: request.limits.youngHeapMb, stackSizeMb: request.limits.stackMb },
    env: {}, execArgv: [],
  }));
  function pump(): void {
    if (stopping || active.size || !queue.length) return;
    const entry = queue.shift()!;
    if (entry.queueTimer) clearTimeout(entry.queueTimer);
    entry.signal?.removeEventListener('abort', entry.dequeueAbort);
    const { request } = entry, secondary: unknown[] = [];
    if (entry.signal?.aborted || Date.now() >= entry.deadline) {
      heldBytes -= entry.bytes; entry.reject(new Error('REPORT_PARSER_QUEUE_EXPIRED')); pump(); return;
    }
    let worker: ParserWorkerLike;
    try { worker = spawn(request); }
    catch (error) {
      heldBytes -= entry.bytes;
      safeLog('report_parser.worker_start_failed', { error, nonce: request.nonce }, secondary);
      entry.reject(errorWithSecondary(error, secondary)); pump(); return;
    }
    let failure: unknown, result: unknown, messageSeen = false, settled = false, exitCode: number | undefined;
    let termination: Promise<number> | undefined;
    let terminationTimer: ReturnType<typeof setTimeout> | undefined;
    let finishExit!: () => void;
    const exited = new Promise<void>(done => { finishExit = done; });
    const reject = () => {
      if (settled) return;
      settled = true;
      const error = failure ?? new Error('REPORT_PARSER_EXIT_INVALID');
      safeLog('report_parser.worker_failed', { error, nonce: request.nonce, operation: request.task.operation, exitCode }, secondary);
      entry.reject(errorWithSecondary(error, secondary));
    };
    const terminate = (error: unknown) => {
      failure ??= error;
      if (!terminationTimer) terminationTimer = setTimeout(() => {
        failure ??= new Error('REPORT_PARSER_TERMINATION_TIMEOUT');
        // 拒绝 UI 等待但保留 active，未退出的线程仍阻断新任务与关机屏障。
        reject();
      }, request.limits.shutdownTimeoutMs);
      if (termination) return;
      try { termination = worker.terminate(); }
      catch (terminationError) { secondary.push(terminationError); safeLog('report_parser.worker_termination_failed', { error: terminationError, nonce: request.nonce }, secondary); return; }
      void termination.catch(error => { secondary.push(error); safeLog('report_parser.worker_termination_failed', { error, nonce: request.nonce }, secondary); });
    };
    const abort = () => terminate(new Error('REPORT_PARSER_ABORTED'));
    active.set(worker, { exited, cancel: abort });
    const timer = setTimeout(() => terminate(new Error('REPORT_PARSER_TIMEOUT')), entry.deadline - Date.now());
    entry.signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (message: ReportParserResponse) => {
      try {
        if (messageSeen || settled) throw new Error('REPORT_PARSER_DUPLICATE_OR_LATE_RESPONSE');
        messageSeen = true;
        result = parseReportParserResponse(message, request);
      } catch (error) {
        const diagnostic = (error as { diagnostic?: unknown })?.diagnostic;
        if (diagnostic) safeLog('report_parser.worker_diagnostic', { diagnostic, nonce: request.nonce }, secondary);
        terminate(error);
      }
    });
    worker.once('error', error => terminate(error));
    worker.once('exit', (code: number) => {
      exitCode = code;
      clearTimeout(timer); if (terminationTimer) clearTimeout(terminationTimer);
      entry.signal?.removeEventListener('abort', abort);
      active.delete(worker); heldBytes -= entry.bytes; finishExit();
      if (failure || code !== 0 || result === undefined) { failure ??= new Error('REPORT_PARSER_EXIT_INVALID:' + code); reject(); }
      else if (!settled) { settled = true; entry.resolve(result); }
      pump();
    });
    if (entry.signal?.aborted) abort();
  }
  function execute<T>(task: ReportParserTask, limits: ReportParserLimits, signal?: AbortSignal): Promise<T> {
    if (stopping || signal?.aborted) return Promise.reject(new Error('REPORT_PARSER_ABORTED'));
    try {
      const request: ReportParserRequest = { protocol: 'report-parser/1', nonce: randomUUID(), task, limits };
      assertReportParserRequest(request);
      const bytes = task.files.reduce((total, file) => total + file.bytes.byteLength, 0);
      if (queue.length >= limits.maxQueueLength || heldBytes + bytes > limits.maxAggregateInputBytes) throw new Error('REPORT_PARSER_QUEUE_LIMIT');
      // 独占 ArrayBuffer 才能转移，避免复制 Buffer 池或使来源快照失效。
      const metadata = structuredClone({ ...task, files: [] });
      request.task = { ...metadata, files: task.files.map(file => ({ ...file, bytes: Uint8Array.from(file.bytes) })) } as ReportParserTask;
      request.limits = structuredClone(limits); heldBytes += bytes;
      shutdownTimeoutMs = limits.shutdownTimeoutMs;
      return new Promise<T>((resolve, reject) => {
        const entry: QueuedRequest = { request, bytes, deadline: Date.now() + limits.timeoutMs, signal,
          resolve: value => resolve(value as T), reject, dequeueAbort: () => {
            const index = queue.indexOf(entry);
            if (index >= 0) { queue.splice(index, 1); heldBytes -= bytes; if (entry.queueTimer) clearTimeout(entry.queueTimer); reject(new Error('REPORT_PARSER_ABORTED')); }
          } };
        entry.queueTimer = setTimeout(() => {
          const index = queue.indexOf(entry);
          if (index >= 0) { queue.splice(index, 1); heldBytes -= bytes; signal?.removeEventListener('abort', entry.dequeueAbort); reject(new Error('REPORT_PARSER_QUEUE_EXPIRED')); }
        }, limits.timeoutMs);
        queue.push(entry); signal?.addEventListener('abort', entry.dequeueAbort, { once: true }); pump();
      });
    } catch (error) {
      const secondary: unknown[] = []; safeLog('report_parser.request_rejected', { error }, secondary);
      return Promise.reject(errorWithSecondary(error, secondary));
    }
  }
  async function stopAndDrain(): Promise<void> {
    stopping = true;
    for (const entry of queue.splice(0)) {
      if (entry.queueTimer) clearTimeout(entry.queueTimer);
      entry.signal?.removeEventListener('abort', entry.dequeueAbort); heldBytes -= entry.bytes;
      entry.reject(new Error('REPORT_PARSER_ABORTED'));
    }
    const current = [...active.values()];
    if (!current.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      for (const entry of current) entry.cancel();
      await Promise.race([Promise.all(current.map(entry => entry.exited)), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('REPORT_PARSER_DRAIN_TIMEOUT')), shutdownTimeoutMs);
      })]);
    } catch (error) {
      const secondary: unknown[] = []; safeLog('report_parser.worker_drain_failed', { error }, secondary);
      throw errorWithSecondary(error, secondary);
    } finally { if (timer) clearTimeout(timer); }
  }
  return { execute, stopAndDrain };
}
