import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { MainIpcOperationTracker } from './main-ipc-operation-tracker';
import { createTrackedIpcRegistrar } from './tracked-ipc-handler';

function fixture() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>();
  const ipc = { handle: (channel: string, listener: typeof handlers extends Map<string, infer V> ? V : never) => handlers.set(channel, listener) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const tracker = new MainIpcOperationTracker();
  const register = createTrackedIpcRegistrar(ipc as unknown as IpcMain, tracker, logger);
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({} as IpcMainInvokeEvent, ...args);
  return { register, invoke, tracker, logger };
}

describe('tracked IPC logging', () => {
  it.each(['sync', 'async'])('logs %s errors without input arguments and preserves rejection identity', async (mode) => {
    const { register, invoke, logger } = fixture();
    const failure = new Error('handler failed');
    register('settings:save', mode === 'sync'
      ? () => { throw failure; }
      : async () => { throw failure; });
    await expect(invoke('settings:save', { password: 'private-input' })).rejects.toBe(failure);
    expect(logger.error).toHaveBeenCalledWith('ipc.handler_failed', { channel: 'settings:save', error: failure });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-input');
  });

  it('preserves results and rejects requests after admission closes', async () => {
    const { register, invoke, tracker, logger } = fixture();
    const listener = vi.fn(() => ({ ok: true }));
    register('app:get-state', listener);
    await expect(invoke('app:get-state')).resolves.toEqual({ ok: true });
    await tracker.stopAndDrain();
    await expect(invoke('app:get-state')).rejects.toMatchObject({ code: 'IPC_ADMISSION_CLOSED' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
