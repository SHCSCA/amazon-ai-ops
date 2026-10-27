import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createDeliveryRuntime } from './delivery-runtime';
import { missingReadinessView } from './delivery-readiness-view';
import type { DeliveryV16Request, DeliveryV16Result } from './delivery-v16-contracts';
import { normalizePersistedOperationScope } from './main-delivery-scope-runtime';
import { loadDeliveryState } from '../renderer/pages/delivery-state-load';

function fixture(options: { batchId?: string; usePersistedScopeNormalizer?: boolean } = {}) {
  let context = normalizeStoreContextEnvelope({ storeId: 'a', browserProfileId: 'profile-a', sessionGeneration: 1, marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16' });
  let mode = { mode: 'manual_approval', revision: 1 };
  const scope = { dateFrom: '2026-10-01', dateTo: '2026-10-15', storeName: 'A', marketplaceCode: 'US',
    ...(options.batchId ? { batchId: options.batchId } : {}) };
  const values = new Map<string, string>();
  let subscriber: () => void = () => undefined;
  const configuration = { get: (key: string) => values.get(key) ?? null, subscribe: vi.fn((callback: () => void) => { subscriber = callback; return vi.fn(); }) };
  const pending: Array<{ request: DeliveryV16Request; signal: AbortSignal; resolve: (result: DeliveryV16Result) => void }> = [];
  const worker = { execute: vi.fn((request: DeliveryV16Request, signal: AbortSignal) => new Promise<DeliveryV16Result>(resolve => pending.push({ request, signal, resolve }))), stopAndDrain: vi.fn(async () => undefined) };
  const root = path.resolve('F:/Temp/amazon-ai-ops-development-tests/runtime-unit');
  const runtime = createDeliveryRuntime({
    appVersion: '1.6.0', paths: { userDataDir: root, codexEvidenceDir: path.join(root, 'old-v15'), downloadsDir: root, exportsDir: root, deliveryBundlesDir: path.join(root, 'bundles'), databasePath: path.join(root, 'db.sqlite'), repositoryRoot: path.join(root, 'NON_EXISTENT_SOURCE'), finalReadinessPath: null },
    getDatabase: () => null, getOperationScope: () => scope, normalizeOperationScope: options.usePersistedScopeNormalizer
      ? normalizePersistedOperationScope : input => input as typeof scope,
    getReadbackAccess: () => { throw new Error('LEGACY_READBACK_PATH_USED'); }, validateAdReadbackAuthority: () => { throw new Error('LEGACY_VERIFIER_USED'); },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    v16Host: { mainModulePath: path.join(root, 'app/dist/main/index.js'), executablePath: path.join(root, 'app.exe'), getStoreContext: () => context, getConfigurationBus: () => configuration, getMode: () => mode, worker },
  });
  function finish(index = 0) { pending[index].resolve({ schemaVersion: 'v16.delivery-result/1', binding: pending[index].request.binding, readiness: missingReadinessView('L6/L7 当前原件缺失', null) }); }
  return { runtime, scope, pending, worker, configuration, values, finish, changeConfiguration: () => subscriber(), setMode: (value: typeof mode) => { mode = value; }, setContext: (value: typeof context) => { context = value; }, get context() { return context; }, root };
}

function loaderPort(input: ReturnType<typeof fixture>) {
  const scope = { ...input.scope, currency: 'USD' as const, storeContext: input.context };
  const current = { configId: 'software-only-config', storeId: input.context.storeId, marketplace: 'US', currency: 'USD',
    businessTimezone: input.context.businessTimezone, status: 'active', revision: 1,
    values: { aiRecommendationsEnabled: false, collectionScheduleLocalTime: '06:00', collectionLookbackDays: 7,
      analysisWindowDays: 30, defaultTargetAcosPercent: 30, minimumRecommendationConfidencePercent: 70, evidenceRetentionDays: 30 },
    createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' };
  const evidence = {
    listing: { readReady: false, draftReady: false, contentCount: 0, fullContentCount: 0, draftCount: 0, aiDraftCount: 0, ruleFallbackDraftCount: 0 },
    readback: { verifiedCount: 0 }, package: { installerAvailable: false },
  };
  input.worker.execute.mockImplementationOnce(async request => ({ schemaVersion: 'v16.delivery-result/1', binding: request.binding,
    readiness: missingReadinessView('隔离软件合同不提供真实环境验收原件', null), evidenceStatus: evidence }));
  const api = {
    getStoreRuntimeConfig: vi.fn(async () => ({ current, versions: [] })),
    getBusinessUiDataPipeline: vi.fn(async () => ({ scope, collection: { latestBatch: { id: 'SOFTWARE-ONLY-LATEST-BATCH' } } })),
    getDeliveryReadiness: vi.fn(async () => missingReadinessView('隔离软件合同不提供真实环境验收原件', null)),
    listAiDiagnosisRuns: vi.fn(async () => []), getRecommendations: vi.fn(async () => []),
    getDeliveryEvidenceStatus: vi.fn((request: unknown) => input.runtime.getEvidenceStatus(request)),
  };
  return { api, scope, evidence };
}

describe('V16 production delivery routing', () => {
  it('uses the trusted runtime worker with current store, mode, scope and installed paths', async () => {
    const input = fixture(), task = input.runtime.getReadiness();
    expect(input.pending[0].request.authority).toMatchObject({ storeContext: input.context, mode: { value: 'manual_approval', revision: 1 }, scope: { storeName: 'A' } });
    expect(input.pending[0].request.paths.appRoot).toBe(path.join(input.root, 'app'));
    expect(input.pending[0].request.paths.workPackageRoot).toBe(path.join(input.root, 'v16-acceptance-work-package'));
    expect(JSON.stringify(input.pending[0].request)).not.toContain('NON_EXISTENT_SOURCE');
    input.finish(); await expect(task).resolves.toMatchObject({ appReady: false });
  });
  it('invalidates A to B to A configuration transitions even if the configured value returns', async () => {
    const input = fixture(), task = input.runtime.getReadiness();
    input.values.set('v16_delivery_work_package_root:v1', path.join(input.root, 'b')); input.changeConfiguration();
    input.values.delete('v16_delivery_work_package_root:v1'); input.changeConfiguration();
    input.finish();
    await expect(task).rejects.toMatchObject({ code: 'DELIVERY_AUTHORITY_CHANGED' });
    expect(input.pending[0].signal.aborted).toBe(true);
  });
  it('captures current mode revisions and profile generation for every call', async () => {
    const input = fixture(), first = input.runtime.getReadiness(); input.finish(); await first;
    input.setMode({ mode: 'policy_auto', revision: 4 }); input.setContext(normalizeStoreContextEnvelope({ ...input.context, sessionGeneration: 2 }));
    const second = input.runtime.getReadiness();
    expect(input.pending[1].request.authority).toMatchObject({ mode: { value: 'policy_auto', revision: 4 }, storeContext: { sessionGeneration: 2 } });
    input.finish(1); await second;
  });
  it('rejects a Renderer scope that differs from the persisted current scope', async () => {
    const input = fixture();
    await expect(input.runtime.getEvidenceStatus({ storeName: 'B' })).rejects.toThrow('V16_RENDERER_SCOPE_NOT_CURRENT');
    expect(input.worker.execute).not.toHaveBeenCalled();
  });
  it('keeps missing embedded runtime negative without invoking any legacy verification', async () => {
    const input = fixture();
    input.worker.execute.mockRejectedValueOnce(new Error('V16_FROZEN_BUILD_NOT_EMBEDDED'));
    await expect(input.runtime.getReadiness()).resolves.toMatchObject({ appReady: false, status: 'APP_NEEDS_WORK', actionItems: expect.arrayContaining([expect.stringContaining('L6')]) });
  });

  it('keeps loader-derived batches outside the persisted delivery evidence scope through the real normalizer', async () => {
    const input = fixture({ usePersistedScopeNormalizer: true }); const { api, scope, evidence } = loaderPort(input);
    const original = structuredClone(scope);
    await expect(loadDeliveryState(api, scope, () => true)).resolves.toMatchObject({ evidence });
    expect(api.getDeliveryEvidenceStatus).toHaveBeenCalledWith(scope);
    expect(input.worker.execute).toHaveBeenCalledTimes(1);
    expect(input.worker.execute.mock.calls[0][0].authority.scope).toEqual(normalizePersistedOperationScope(input.scope));
    expect(input.worker.execute.mock.calls[0][0].authority.scope).not.toHaveProperty('batchId');
    expect(api.listAiDiagnosisRuns).toHaveBeenCalledWith({ ...scope, batchId: 'SOFTWARE-ONLY-LATEST-BATCH', limit: 5 });
    for (const status of ['pending', 'needs_review', 'approved']) {
      expect(api.getRecommendations).toHaveBeenCalledWith({ ...scope, batchId: 'SOFTWARE-ONLY-LATEST-BATCH', limit: 20, status });
    }
    await expect(input.runtime.getEvidenceStatus({ ...scope, batchId: 'SOFTWARE-ONLY-LATEST-BATCH' }))
      .rejects.toThrow('V16_RENDERER_SCOPE_NOT_CURRENT');
    expect(input.worker.execute).toHaveBeenCalledTimes(1); expect(scope).toEqual(original);
  });

  it('requires an explicitly selected loader batch to match the persisted Main scope through the real normalizer', async () => {
    const input = fixture({ batchId: 'SOFTWARE-ONLY-SELECTED-BATCH', usePersistedScopeNormalizer: true });
    const { api, scope, evidence } = loaderPort(input); const original = structuredClone(scope);
    await expect(loadDeliveryState(api, scope, () => true)).resolves.toMatchObject({ evidence });
    expect(api.getDeliveryEvidenceStatus).toHaveBeenCalledWith(scope);
    expect(input.worker.execute).toHaveBeenCalledTimes(1);
    expect(input.worker.execute.mock.calls[0][0].authority.scope).toEqual(normalizePersistedOperationScope(input.scope));
    expect(input.worker.execute.mock.calls[0][0].authority.scope).toHaveProperty('batchId', 'SOFTWARE-ONLY-SELECTED-BATCH');
    expect(api.listAiDiagnosisRuns).toHaveBeenCalledWith({ ...scope, limit: 5 });
    for (const status of ['pending', 'needs_review', 'approved']) {
      expect(api.getRecommendations).toHaveBeenCalledWith({ ...scope, limit: 20, status });
    }
    for (const batchId of [undefined, 'SOFTWARE-ONLY-LATEST-BATCH']) {
      await expect(input.runtime.getEvidenceStatus({ ...scope, batchId })).rejects.toThrow('V16_RENDERER_SCOPE_NOT_CURRENT');
    }
    expect(input.worker.execute).toHaveBeenCalledTimes(1); expect(scope).toEqual(original);
  });
});
