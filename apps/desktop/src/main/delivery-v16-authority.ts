import { createHash, randomUUID } from 'node:crypto';
import type { RuntimeLogPort } from './runtime-logger';
import type {
  DeliveryV16Authority, DeliveryV16Binding, DeliveryV16Operation,
  DeliveryV16Paths, DeliveryV16Request, DeliveryV16Result, DeliveryV16WorkerPort,
} from './delivery-v16-contracts';

export class DeliveryV16AuthorityError extends Error {
  constructor(readonly code: 'DELIVERY_STOPPING' | 'DELIVERY_AUTHORITY_CHANGED' | 'DELIVERY_WORKER_BINDING_INVALID') {
    super(code);
    this.name = 'DeliveryV16AuthorityError';
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right, 'en')).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('DELIVERY_AUTHORITY_NOT_SERIALIZABLE');
  return encoded;
}

export function deliveryAuthoritySha256(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function sameDeliveryBinding(left: DeliveryV16Binding, right: DeliveryV16Binding): boolean {
  return left.nonce === right.nonce && left.epoch === right.epoch && left.authoritySha256 === right.authoritySha256;
}

export interface DeliveryV16AuthorityOptions {
  readonly appVersion: string;
  readonly readAuthority: () => DeliveryV16Authority;
  readonly readPaths: () => DeliveryV16Paths;
  readonly worker: DeliveryV16WorkerPort;
  readonly logger: Pick<RuntimeLogPort, 'info' | 'warn' | 'error'>;
  readonly invalidateOutputs: (request: DeliveryV16Request, error: unknown) => Promise<void>;
}

export function createDeliveryV16Authority(options: DeliveryV16AuthorityOptions) {
  let epoch = 0;
  let stopping = false;
  const active = new Map<string, { controller: AbortController; task: Promise<DeliveryV16Result> }>();
  const unresolvedInvalidations = new Map<string, { request: DeliveryV16Request; error: unknown }>();

  function invalidate(reason: string): void {
    epoch += 1;
    for (const { controller } of active.values()) controller.abort(new DeliveryV16AuthorityError('DELIVERY_AUTHORITY_CHANGED'));
    options.logger.info('delivery.v16_authority_invalidated', { reason, epoch, activeCount: active.size });
  }

  async function run(operation: DeliveryV16Operation): Promise<DeliveryV16Result> {
    if (stopping) throw new DeliveryV16AuthorityError('DELIVERY_STOPPING');
    const authority = JSON.parse(JSON.stringify(options.readAuthority())) as DeliveryV16Authority;
    const paths = JSON.parse(JSON.stringify(options.readPaths())) as DeliveryV16Paths;
    const binding = Object.freeze({ nonce: randomUUID(), epoch, authoritySha256: deliveryAuthoritySha256({ authority, paths }) });
    const request: DeliveryV16Request = Object.freeze({
      schemaVersion: 'v16.delivery-request/1', binding, operation, authority, paths,
      appVersion: options.appVersion, nativeAbi: process.versions.modules,
    });
    const controller = new AbortController();
    // 先登记请求，再同步启动 Worker，避免启动异常留下不可等待的线程。
    let resolveTask!: (value: DeliveryV16Result) => void;
    let rejectTask!: (error: unknown) => void;
    const task = new Promise<DeliveryV16Result>((resolve, reject) => { resolveTask = resolve; rejectTask = reject; });
    active.set(binding.nonce, { controller, task });
    try {
      const result = await options.worker.execute(request, controller.signal);
      if (result.schemaVersion !== 'v16.delivery-result/1' || !sameDeliveryBinding(binding, result.binding)) {
        throw new DeliveryV16AuthorityError('DELIVERY_WORKER_BINDING_INVALID');
      }
      if (stopping || controller.signal.aborted || epoch !== binding.epoch
        || deliveryAuthoritySha256({ authority: options.readAuthority(), paths: options.readPaths() }) !== binding.authoritySha256) {
        throw new DeliveryV16AuthorityError('DELIVERY_AUTHORITY_CHANGED');
      }
      resolveTask(result);
      return result;
    } catch (caught) {
      const error = controller.signal.aborted || epoch !== binding.epoch
        ? new DeliveryV16AuthorityError('DELIVERY_AUTHORITY_CHANGED') : caught;
      try { await options.invalidateOutputs(request, error); }
      catch (cleanupError) {
        unresolvedInvalidations.set(binding.nonce, { request, error });
        options.logger.error('delivery.v16_invalidation_failed', { error: cleanupError, nonce: binding.nonce });
        const failure = new AggregateError([error, cleanupError], 'DELIVERY_RESULT_AND_INVALIDATION_FAILED');
        rejectTask(failure);
        throw failure;
      }
      options.logger.error('delivery.v16_verification_failed', { error, nonce: binding.nonce, epoch: binding.epoch });
      rejectTask(error);
      throw error;
    } finally {
      // 关闭路径等待同一任务，拒绝已由调用者接收，不产生独立的未处理拒绝。
      void task.catch(() => undefined);
      active.delete(binding.nonce);
    }
  }

  function stopAndDrain(ipcDrain: () => Promise<void> = async () => undefined): Promise<void> {
    stopping = true;
    invalidate('shutdown');
    const admitted = [...active.values()].map(({ task }) => task);
    const operations: Promise<unknown>[] = [];
    for (const start of [() => options.worker.stopAndDrain(), ipcDrain]) {
      try { operations.push(Promise.resolve(start())); }
      catch (error) { operations.push(Promise.reject(error)); }
    }
    return Promise.allSettled(operations).then(async settled => {
      const drainFailures = settled.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (drainFailures.length) throw new AggregateError(drainFailures, 'DELIVERY_WORKER_DRAIN_FAILED');
      await Promise.allSettled(admitted);
      const failures: unknown[] = [];
      for (const [nonce, pending] of unresolvedInvalidations) {
        try { await options.invalidateOutputs(pending.request, pending.error); unresolvedInvalidations.delete(nonce); }
        catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'DELIVERY_WORKER_DRAIN_FAILED');
    });
  }

  return { run, invalidate, stopAndDrain, inspect: () => ({ epoch, stopping, activeCount: active.size }) };
}
