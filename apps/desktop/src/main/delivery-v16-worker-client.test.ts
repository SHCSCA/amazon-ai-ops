import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { createDeliveryV16WorkerClient } from './delivery-v16-worker-client';
import type { DeliveryV16Request } from './delivery-v16-contracts';

const roots: string[] = [];
function fixture(source: string, timeoutMs: number | (() => number) = 2_000) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-worker-client-'));
  roots.push(root);
  const workerPath = path.join(root, 'worker.cjs');
  fs.writeFileSync(workerPath, `const {parentPort,workerData}=require('node:worker_threads');\n${source}`);
  const request = {
    schemaVersion: 'v16.delivery-request/1', binding: { nonce: 'test-nonce', epoch: 0, authoritySha256: 'hash' },
    nativeAbi: process.versions.modules, paths: { workerPath },
  } as DeliveryV16Request;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const runtime = createDeliveryV16WorkerClient({ logger, timeoutMs });
  return { root, workerPath, request, logger, runtime };
}
const response = `parentPort.postMessage({nativeAbi:process.versions.modules,result:{schemaVersion:'v16.delivery-result/1',binding:workerData.binding,readiness:{appReady:false}}});`;
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('V16 actual worker lifecycle', () => {
  it('waits for actual thread exit after a result message', async () => {
    const input = fixture(`${response}setTimeout(()=>require('node:fs').writeFileSync(workerData.paths.workerPath+'.exited','done'),80);`);
    const result = await input.runtime.execute(input.request, new AbortController().signal);
    expect(result.readiness.appReady).toBe(false);
    expect(fs.readFileSync(input.workerPath + '.exited', 'utf8')).toBe('done');
    await input.runtime.stopAndDrain();
  });
  it('terminates and drains a running thread on cancellation', async () => {
    const input = fixture('setInterval(()=>{},1000);');
    const controller = new AbortController();
    const task = input.runtime.execute(input.request, controller.signal);
    const rejection = expect(task).rejects.toThrow('DELIVERY_WORKER_ABORTED');
    controller.abort();
    await input.runtime.stopAndDrain();
    await rejection;
    await expect(input.runtime.execute(input.request, new AbortController().signal)).rejects.toThrow('DELIVERY_WORKER_ABORTED');
  });
  it('rejects a result from a different native ABI', async () => {
    const input = fixture(response.replace('nativeAbi:process.versions.modules', "nativeAbi:'wrong-abi'"));
    await expect(input.runtime.execute(input.request, new AbortController().signal)).rejects.toThrow('DELIVERY_WORKER_NATIVE_ABI_MISMATCH');
  });
  it('records diagnostics through the shared log port before resolving a negative result', async () => {
    const input = fixture(response.replace('result:{', "diagnostics:[{event:'missing-native-original',level:'warn'}],result:{"));
    await input.runtime.execute(input.request, new AbortController().signal);
    expect(input.logger.warn).toHaveBeenCalledWith('delivery.worker_diagnostic', expect.objectContaining({ diagnostic: { event: 'missing-native-original', level: 'warn' }, nonce: 'test-nonce' }));
  });
  it('rechecks timeout configuration for each admitted request and terminates on expiry', async () => {
    let timeout = 10;
    const input = fixture('setInterval(()=>{},1000);', () => timeout);
    await expect(input.runtime.execute(input.request, new AbortController().signal)).rejects.toThrow('DELIVERY_WORKER_TIMEOUT');
    timeout = -1;
    await expect(input.runtime.execute(input.request, new AbortController().signal)).rejects.toThrow('DELIVERY_WORKER_TIMEOUT_INVALID');
    await input.runtime.stopAndDrain();
  });
  it('retains the actual worker error and rejects a thread with no result', async () => {
    const input = fixture("throw new Error('ACTUAL_THREAD_FAILURE');");
    await expect(input.runtime.execute(input.request, new AbortController().signal)).rejects.toThrow('ACTUAL_THREAD_FAILURE');
    const empty = fixture('parentPort.close();');
    await expect(empty.runtime.execute(empty.request, new AbortController().signal)).rejects.toThrow('DELIVERY_WORKER_EXIT_INVALID');
  });
  it('keeps drain failure visible when native termination refuses', async () => {
    const listeners = new Map<string, (...values: any[]) => void>();
    const worker = { once: (event: string, listener: (...values: any[]) => void) => listeners.set(event, listener), terminate: vi.fn(async () => { throw new Error('NATIVE_TERMINATION_REFUSED'); }) };
    const input = fixture('parentPort.close();');
    const runtime = createDeliveryV16WorkerClient({ logger: input.logger, createWorker: () => worker });
    const task = runtime.execute(input.request, new AbortController().signal);
    await expect(runtime.stopAndDrain()).rejects.toThrow('DELIVERY_WORKER_TERMINATION_FAILED');
    listeners.get('exit')!(1);
    await expect(task).rejects.toThrow('DELIVERY_WORKER_EXIT_INVALID');
  });
});

function shutdownWorkerModel() {
  const listeners = new Map<string, (...values: any[]) => void>();
  let exited = false;
  const exit = () => { if (!exited) { exited = true; listeners.get('exit')!(1); } };
  const worker = { once: (event: string, listener: (...values: any[]) => void) => listeners.set(event, listener),
    terminate: vi.fn(async () => { exit(); return 1; }) };
  return { worker, exit };
}

describe('空 worker 安全排空', () => {
  it('空集合不读取繁忙数据库配置，并保留停止后的请求拒绝', async () => {
    const input = fixture('parentPort.close();');
    const readBudget = vi.fn(() => { throw new Error('DATABASE_BUSY_EXECUTING_QUERY'); });
    const createWorker = vi.fn(() => { throw new Error('STOPPED_WORKER_MUST_NOT_SPAWN'); });
    const runtime = createDeliveryV16WorkerClient({ logger: input.logger, createWorker, shutdownTimeoutMs: readBudget });
    await expect(runtime.stopAndDrain()).resolves.toBeUndefined();
    await expect(runtime.stopAndDrain()).resolves.toBeUndefined();
    expect(readBudget).not.toHaveBeenCalled();
    await expect(runtime.execute(input.request, new AbortController().signal)).rejects.toThrow('DELIVERY_WORKER_ABORTED');
    expect(createWorker).not.toHaveBeenCalled();
  });
  it('非空集合的配置异常保持可见，恢复配置后仍正常终止并排空', async () => {
    const input = fixture('parentPort.close();'), model = shutdownWorkerModel();
    const busy = new Error('DATABASE_BUSY_EXECUTING_QUERY');
    let blocked = true;
    const readBudget = vi.fn(() => { if (blocked) throw busy; return 25; });
    const runtime = createDeliveryV16WorkerClient({ logger: input.logger, createWorker: () => model.worker, shutdownTimeoutMs: readBudget });
    const result = runtime.execute(input.request, new AbortController().signal).catch(error => error);
    try {
      await expect(runtime.stopAndDrain()).rejects.toBe(busy);
      expect(model.worker.terminate).not.toHaveBeenCalled();
      await expect(runtime.execute(input.request, new AbortController().signal)).rejects.toThrow('DELIVERY_WORKER_ABORTED');
      blocked = false;
      await expect(runtime.stopAndDrain()).resolves.toBeUndefined();
      expect(readBudget).toHaveBeenCalledTimes(2);
      expect(model.worker.terminate).toHaveBeenCalledTimes(1);
      expect((await result).message).toBe('DELIVERY_WORKER_EXIT_INVALID:1');
    } finally { model.exit(); await result; }
  });
  it.each([0, -1, 1.5, Infinity, NaN])('非空集合拒绝无效关闭预算 %s 并保留可重试状态', async invalid => {
    const input = fixture('parentPort.close();'), model = shutdownWorkerModel();
    let budget = invalid;
    const readBudget = vi.fn(() => budget);
    const runtime = createDeliveryV16WorkerClient({ logger: input.logger, createWorker: () => model.worker, shutdownTimeoutMs: readBudget });
    const result = runtime.execute(input.request, new AbortController().signal).catch(error => error);
    try {
      await expect(runtime.stopAndDrain()).rejects.toThrow('DELIVERY_WORKER_SHUTDOWN_TIMEOUT_INVALID');
      expect(model.worker.terminate).not.toHaveBeenCalled();
      budget = 25;
      await expect(runtime.stopAndDrain()).resolves.toBeUndefined();
      expect(readBudget).toHaveBeenCalledTimes(2);
      expect(model.worker.terminate).toHaveBeenCalledTimes(1);
      expect((await result).message).toBe('DELIVERY_WORKER_EXIT_INVALID:1');
    } finally { model.exit(); await result; }
  });
  it('非空线程未退出时仍按配置预算拒绝，不能将超时当成排空', async () => {
    const input = fixture('parentPort.close();'), model = shutdownWorkerModel();
    model.worker.terminate.mockImplementation(() => new Promise<number>(() => {}));
    const readBudget = vi.fn(() => 25);
    const runtime = createDeliveryV16WorkerClient({ logger: input.logger, createWorker: () => model.worker, shutdownTimeoutMs: readBudget });
    const result = runtime.execute(input.request, new AbortController().signal).catch(error => error);
    try {
      const failure = await runtime.stopAndDrain().catch(error => error);
      expect(failure).toBeInstanceOf(AggregateError);
      expect(failure.message).toBe('DELIVERY_WORKER_TERMINATION_FAILED');
      expect(failure.errors.map((error: Error) => error.message)).toEqual(['DELIVERY_WORKER_SHUTDOWN_TIMEOUT']);
      expect(readBudget).toHaveBeenCalledTimes(1);
      expect(model.worker.terminate).toHaveBeenCalledTimes(1);
    } finally { model.exit(); await result; }
  });
});
