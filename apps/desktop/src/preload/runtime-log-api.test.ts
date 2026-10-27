import { describe, expect, it, vi } from 'vitest';
import { createRuntimeLogPreloadApi } from './runtime-log-api';
import { RENDERER_RUNTIME_LOG_CHANNEL } from '../shared/runtime-log-contract';

describe('runtime log preload bridge', () => {
  it('exposes only the fixed report channel', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = createRuntimeLogPreloadApi({ invoke });
    const report = { level: 'error' as const, event: 'renderer.failed' };
    await api.reportRuntimeLog(report);
    expect(Object.keys(api)).toEqual(['reportRuntimeLog']);
    expect(invoke).toHaveBeenCalledWith(RENDERER_RUNTIME_LOG_CHANNEL, report);
    expect(Object.isFrozen(api)).toBe(true);
  });
});
