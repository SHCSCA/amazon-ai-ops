import { describe, expect, it, vi } from 'vitest';
import { createRendererRuntimeLog, installRendererRuntimeErrorHandlers } from './runtime-log';

describe('renderer runtime logging', () => {
  it('sends redacted reports through the protected bridge', () => {
    const reportRuntimeLog = vi.fn().mockResolvedValue(undefined);
    const fallback = vi.fn();
    const logger = createRendererRuntimeLog({ getBridge: () => ({ reportRuntimeLog }), fallback });
    logger.error('renderer.failed', { error: new Error('password=private-password'), token: 'private-token' });
    expect(reportRuntimeLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(reportRuntimeLog.mock.calls)).not.toContain('private-password');
    expect(JSON.stringify(reportRuntimeLog.mock.calls)).not.toContain('private-token');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('preserves the original record and delivery failure if IPC rejects', async () => {
    const fallback = vi.fn();
    const logger = createRendererRuntimeLog({ getBridge: () => ({ reportRuntimeLog: () => Promise.reject(new Error('closed')) }), fallback });
    logger.error('renderer.failed', { reason: 'original' });
    await Promise.resolve();
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(fallback.mock.calls[0][0]).toMatchObject({ event: 'renderer.failed', context: { reason: 'original' } });
    expect(fallback.mock.calls[1][0].event).toBe('renderer.log_delivery_failed');
  });

  it('contains absent bridges, broken clocks and unavailable fallback sinks', () => {
    const fallback = vi.fn();
    createRendererRuntimeLog({ getBridge: () => undefined, fallback }).warn('renderer.offline');
    expect(fallback.mock.calls[0][0]).toMatchObject({ level: 'warn', event: 'renderer.offline' });
    const logger = createRendererRuntimeLog({ getBridge: () => undefined, now: () => { throw new Error('clock'); }, fallback });
    expect(() => logger.error('renderer.failed')).not.toThrow();
    expect(fallback.mock.calls[1][0].event).toBe('renderer.log_encoding_failed');
    expect(() => createRendererRuntimeLog({ getBridge: () => undefined, fallback: () => { throw new Error('sink'); } }).error('renderer.failed')).not.toThrow();
  });

  it('installs error and rejection handlers only once per target', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const addEventListener = vi.fn((type: string, listener: (event: unknown) => void) => { listeners.set(type, listener); });
    const target = { addEventListener } as unknown as Pick<Window, 'addEventListener'>;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    installRendererRuntimeErrorHandlers(target, logger);
    installRendererRuntimeErrorHandlers(target, logger);
    expect(addEventListener).toHaveBeenCalledTimes(2);
    const error = new Error('original');
    listeners.get('error')!({ error });
    listeners.get('unhandledrejection')!({ reason: error });
    expect(logger.error).toHaveBeenCalledWith('renderer.uncaught_error', { error });
    expect(logger.error).toHaveBeenCalledWith('renderer.unhandled_rejection', { error });
  });
});
