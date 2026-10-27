import { Worker } from 'node:worker_threads';
import type { RuntimeLogPort } from './runtime-logger';
import type { DeliveryV16Request, DeliveryV16Result, DeliveryV16WorkerPort } from './delivery-v16-contracts';

export interface DeliveryWorkerLike {
  once(event: string, listener: (...values: any[]) => void): unknown;
  terminate(): Promise<number>;
}

export interface DeliveryV16WorkerClientOptions {
  readonly logger: Pick<RuntimeLogPort, 'info' | 'warn' | 'error'>;
  readonly createWorker?: (request: DeliveryV16Request) => DeliveryWorkerLike;
  readonly timeoutMs?: number | (() => number);
  readonly shutdownTimeoutMs?: number | (() => number);
}

export function createDeliveryV16WorkerClient(options: DeliveryV16WorkerClientOptions): DeliveryV16WorkerPort {
  const active = new Map<DeliveryWorkerLike, Promise<void>>();
  let stopping = false;
  const spawn = options.createWorker ?? (request => new Worker(request.paths.workerPath, { workerData: request }));

  function execute(request: DeliveryV16Request, signal: AbortSignal): Promise<DeliveryV16Result> {
    if (stopping || signal.aborted) return Promise.reject(new Error('DELIVERY_WORKER_ABORTED'));
    const timeoutMs = typeof options.timeoutMs === 'function' ? options.timeoutMs() : options.timeoutMs ?? 300_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new TypeError('DELIVERY_WORKER_TIMEOUT_INVALID'));
    return new Promise((resolve, reject) => {
      let worker: DeliveryWorkerLike;
      try { worker = spawn(request); }
      catch (error) { reject(error); return; }
      let result: DeliveryV16Result | undefined;
      let failure: unknown;
      let termination: Promise<number> | undefined;
      let finishExit!: () => void;
      const exited = new Promise<void>(done => { finishExit = done; });
      active.set(worker, exited);
      // 取消必须等线程真正退出；消息到达不能提前释放 DB 关闭屏障。
      const terminate = (error: unknown) => {
        failure ??= error;
        if (!termination) {
          try { termination = worker.terminate(); }
          catch (terminationError) {
            options.logger.error('delivery.worker_termination_failed', { error: terminationError, nonce: request.binding.nonce });
            return;
          }
          void termination.catch(error => options.logger.error('delivery.worker_termination_failed', { error, nonce: request.binding.nonce }));
        }
      };
      const abort = () => terminate(new Error('DELIVERY_WORKER_ABORTED'));
      const timer = setTimeout(() => terminate(new Error('DELIVERY_WORKER_TIMEOUT')), timeoutMs);
      signal.addEventListener('abort', abort, { once: true });
      worker.once('message', (message: { result?: DeliveryV16Result; diagnostics?: unknown[]; error?: { code?: string; message?: string }; nativeAbi?: string }) => {
        for (const diagnostic of message.diagnostics ?? []) options.logger.warn('delivery.worker_diagnostic', { diagnostic, nonce: request.binding.nonce });
        if (message.nativeAbi !== request.nativeAbi) failure = new Error('DELIVERY_WORKER_NATIVE_ABI_MISMATCH');
        else if (message.error) failure = new Error(`${message.error.code ?? 'DELIVERY_WORKER_FAILED'}:${message.error.message ?? ''}`);
        else result = message.result;
      });
      worker.once('error', error => { failure = error; });
      worker.once('exit', (code: number) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        active.delete(worker);
        finishExit();
        if (failure || code !== 0 || !result) reject(failure ?? new Error(`DELIVERY_WORKER_EXIT_INVALID:${code}`));
        else resolve(result);
      });
      if (signal.aborted) abort();
    });
  }

  async function stopAndDrain(): Promise<void> {
    stopping = true;
    const workers = [...active.entries()];
    // 空集合已排空，避免关闭阶段再触发数据库配置读取。
    if (workers.length === 0) return;
    const timeoutMs = typeof options.shutdownTimeoutMs === 'function' ? options.shutdownTimeoutMs() : options.shutdownTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('DELIVERY_WORKER_SHUTDOWN_TIMEOUT_INVALID');
    const results = await Promise.allSettled(workers.map(async ([worker, exited]) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          worker.terminate().then(() => exited),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('DELIVERY_WORKER_SHUTDOWN_TIMEOUT')), timeoutMs); }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
    }));
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, 'DELIVERY_WORKER_TERMINATION_FAILED');
  }

  return { execute, stopAndDrain };
}
