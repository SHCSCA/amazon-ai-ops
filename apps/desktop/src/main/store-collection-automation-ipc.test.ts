import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { registerStoreCollectionAutomationIpcHandlers } from './store-collection-automation-ipc';
import { STORE_COLLECTION_AUTOMATION_IPC_CHANNELS } from '../shared/store-collection-automation-ipc';

const context = { storeId: 'store-a', browserProfileId: 'profile-a', marketplace: 'US', currency: 'USD',
  businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-21', sessionGeneration: 1 } as StoreContextEnvelope;
const projection = { storeId: context.storeId, browserProfileId: context.browserProfileId,
  automaticCollectionEnabled: true, source: 'legacy-default', revision: 0, updatedAt: null } as const;
function setup() {
  const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
  const service = { get: vi.fn(() => projection), set: vi.fn(() => ({ ...projection, automaticCollectionEnabled: false,
    source: 'explicit-override' as const, revision: 1, updatedAt: '2026-10-22T06:00:00.000Z' })) };
  const logger = { error: vi.fn() }, changed = vi.fn();
  registerStoreCollectionAutomationIpcHandlers({ handle: (channel, listener) => { handlers.set(channel, listener); } }, service, logger, changed);
  return { handlers, service, logger, changed };
}

describe('store collection automation IPC', () => {
  it('registers only get and set and keeps default reads free of mutations', () => {
    const f = setup();
    expect([...f.handlers.keys()]).toEqual(STORE_COLLECTION_AUTOMATION_IPC_CHANNELS);
    expect(f.handlers.get('store-collection-automation:get')!({}, { storeContext: context })).toEqual(projection);
    expect(f.service.get).toHaveBeenCalledWith(context);
    expect(f.service.set).not.toHaveBeenCalled();
    expect(f.changed).not.toHaveBeenCalled();
  });
  it('forwards exact full context and revision zero false only through the formal service', () => {
    const f = setup(), input = { expectedRevision: 0, automaticCollectionEnabled: false };
    const result = f.handlers.get('store-collection-automation:set')!({}, { storeContext: context, input });
    expect(f.service.set).toHaveBeenCalledWith(context, input);
    expect(result).toMatchObject({ automaticCollectionEnabled: false, source: 'explicit-override', revision: 1 });
    expect(f.changed).toHaveBeenCalledOnce();
    expect(f.changed).toHaveBeenCalledWith(context);
  });
  it.each([
    ['missing request', undefined], ['extra get input', { storeContext: context, input: {} }],
    ['missing profile', { storeContext: { ...context, browserProfileId: undefined } }],
    ['missing session', { storeContext: { ...context, sessionGeneration: undefined } }],
    ['extra context field', { storeContext: { ...context, authority: true } }],
  ])('rejects %s before a read service runs', (_name, value) => {
    const f = setup();
    expect(() => f.handlers.get('store-collection-automation:get')!({}, value)).toThrow();
    expect(f.service.get).not.toHaveBeenCalled();
    expect(f.service.set).not.toHaveBeenCalled();
    expect(f.logger.error).toHaveBeenCalledWith('main.store_collection_automation_ipc_failed', expect.objectContaining({ channel: 'store-collection-automation:get' }));
  });
  it.each([
    ['missing input', undefined], ['missing flag', { expectedRevision: 0 }],
    ['negative revision', { expectedRevision: -1, automaticCollectionEnabled: false }],
    ['unsafe revision', { expectedRevision: Number.MAX_SAFE_INTEGER + 1, automaticCollectionEnabled: false }],
    ['string flag', { expectedRevision: 0, automaticCollectionEnabled: 'false' }],
    ['extra authority', { expectedRevision: 0, automaticCollectionEnabled: false, approved: true }],
  ])('rejects %s before a mutation service runs', (_name, input) => {
    const f = setup();
    expect(() => f.handlers.get('store-collection-automation:set')!({}, { storeContext: context, input })).toThrow();
    expect(f.service.set).not.toHaveBeenCalled();
    expect(f.changed).not.toHaveBeenCalled();
    expect(f.logger.error).toHaveBeenCalledOnce();
  });
  it('logs and preserves revision conflicts without publishing a change', () => {
    const f = setup(), error = Object.assign(new Error('当前店铺范围或配置版本已变化。'), { code: 'REVISION_CONFLICT' });
    f.service.set.mockImplementation(() => { throw error; });
    expect(() => f.handlers.get('store-collection-automation:set')!({}, { storeContext: context,
      input: { expectedRevision: 0, automaticCollectionEnabled: false } })).toThrow(error);
    expect(f.changed).not.toHaveBeenCalled();
    expect(f.logger.error).toHaveBeenCalledWith('main.store_collection_automation_ipc_failed', { channel: 'store-collection-automation:set', error });
  });
  it('preserves Main rejection of a structurally valid foreign profile context', () => {
    const f = setup(), error = Object.assign(new Error('店铺与浏览器资料不匹配。'), { code: 'STORE_IDENTITY_MISMATCH' });
    f.service.get.mockImplementation(() => { throw error; });
    expect(() => f.handlers.get('store-collection-automation:get')!({}, { storeContext: { ...context, browserProfileId: 'profile-b' } })).toThrow(error);
    expect(f.service.set).not.toHaveBeenCalled();
    expect(f.changed).not.toHaveBeenCalled();
    expect(f.logger.error).toHaveBeenCalledOnce();
  });
  it('retains the original failure when the required structured logger also fails', () => {
    const f = setup(), serviceError = new Error('店铺状态损坏。'), loggingError = new Error('日志出口关闭。');
    f.service.get.mockImplementation(() => { throw serviceError; });
    f.logger.error.mockImplementation(() => { throw loggingError; });
    try { f.handlers.get('store-collection-automation:get')!({}, { storeContext: context }); }
    catch (error) { expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([serviceError, loggingError]); return; }
    throw new Error('预期请求与日志双重失败。');
  });
  it('wires the required real Main state service through the tracked registrar and shared logger', () => {
    const source = readFileSync(new URL('./main-ipc-registration-runtime.ts', import.meta.url), 'utf8');
    expect(source).toContain('if (!mainRuntimeContext.state.storeCollectionAutomationService)');
    expect(source).toMatch(/registerStoreCollectionAutomationIpcHandlers\(\s*mainRuntimeContext\.trackedIpcRegistrar,\s*mainRuntimeContext\.state\.storeCollectionAutomationService,\s*runtimeLogger,/);
  });
});
