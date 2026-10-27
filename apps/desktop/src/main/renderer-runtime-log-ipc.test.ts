import { describe, expect, it } from 'vitest';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { RuntimeLogger } from './runtime-logger';
import { MainIpcOperationTracker } from './main-ipc-operation-tracker';
import { createTrackedIpcRegistrar } from './tracked-ipc-handler';
import { registerRendererRuntimeLogIpc } from './renderer-runtime-log-ipc';
import { RENDERER_RUNTIME_LOG_CHANNEL } from '../shared/runtime-log-contract';
import { createRendererRuntimeLog } from '../renderer/runtime-log';
import { createRuntimeLogPreloadApi } from '../preload/runtime-log-api';

function fixture() {
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>();
  const records: Array<Record<string, any>> = [];
  const logger = new RuntimeLogger({ write: (_level, line) => { records.push(JSON.parse(line)); } });
  const ipc = { handle: (channel: string, handler: Parameters<IpcMain['handle']>[1]) => { handlers.set(channel, handler); } };
  const tracked = createTrackedIpcRegistrar(ipc as IpcMain, new MainIpcOperationTracker(), logger);
  registerRendererRuntimeLogIpc({ handle: (channel, handler) => tracked(channel, handler) }, logger);
  return { records, invoke: (input: unknown) => handlers.get(RENDERER_RUNTIME_LOG_CHANNEL)!({} as IpcMainInvokeEvent, input) };
}

describe('renderer runtime log IPC', () => {
  it('keeps reported events separate from authoritative business events', async () => {
    const { records, invoke } = fixture();
    await invoke({ level: 'error', event: 'ad.execution.succeeded', context: { apiKey: 'private-key', reason: 'failed' } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ event: 'renderer.reported', context: { reportedEvent: 'ad.execution.succeeded', details: { apiKey: '[REDACTED]' } } });
    expect(JSON.stringify(records)).not.toContain('private-key');
  });

  it('records invalid report failures through the same tracked IPC boundary', async () => {
    const { records, invoke } = fixture();
    await expect(invoke({ level: 'unsupported', event: 'renderer.failed', context: { password: 'private-password' } })).rejects.toThrow('级别');
    expect(records.some(record => record.level === 'error')).toBe(true);
    expect(JSON.stringify(records)).not.toContain('private-password');
  });

  it('keeps identity aliases stable from Renderer through Preload to the Main sink', async () => {
    const { records, invoke } = fixture();
    let completion: Promise<unknown> = Promise.resolve();
    let reported: unknown;
    const bridge = createRuntimeLogPreloadApi({ invoke: (_channel, report) => { reported = report; completion = Promise.resolve(invoke(report)); return completion; } });
    const logger = createRendererRuntimeLog({ getBridge: () => bridge, fallback: () => { throw new Error('unexpected fallback'); } });
    logger.error('renderer.operation_failed', { storeId: 'formal-store-a', browserProfileId: 'formal-profile-a',
      jobId: 'formal-job-a', importRunId: 'formal-import-a', error: new Error('C:\\Users\\Private Operator\\app.db') });
    await completion;
    expect(records).toHaveLength(1);
    const context = (reported as { context: Record<string, unknown> }).context;
    expect(records[0].context.details).toEqual(context);
    expect(context.storeId).toMatch(/^\[store:[a-f0-9]{20}\]$/);
    for (const raw of ['formal-store-a', 'formal-profile-a', 'formal-job-a', 'formal-import-a', 'Private Operator']) {
      expect(JSON.stringify({ reported, records })).not.toContain(raw);
    }
  });

  it('rejects invalid context shapes and oversized reports without logging inputs', async () => {
    const { records, invoke } = fixture();
    await expect(invoke({ level: 'error', event: 'renderer.failed', context: [] })).rejects.toThrow('上下文');
    const context = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, 'x'.repeat(8000)]));
    await expect(invoke({ level: 'warn', event: 'renderer.failed', context })).rejects.toThrow('超过上限');
    expect(JSON.stringify(records).length).toBeLessThan(20_000);
  });
});
