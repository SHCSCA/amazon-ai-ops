import { describe, expect, it, vi } from 'vitest';
import { LingxingImportRepository } from '@amazon-ai-ops/local-db';
import { StoreRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-repo';
import { createHarness, seedActiveMission } from '@amazon-ai-ops/local-db/src/sqlite/repositories/mission-domain-repo.test-harness';
import { NOW } from '@amazon-ai-ops/local-db/src/sqlite/repositories/mission-domain-repo.test-data';
import { readStoreCollectionAutomation } from '@amazon-ai-ops/shared-types';
import { ConfigurationBus } from './configuration-bus';
import { DurableStoreSessionGenerationAuthority, StoreCoordinator } from './store-coordinator';
import { StoreRuntimeConfigService } from './store-runtime-config-service';
import { StoreCollectionSchedulerReadModel } from './store-collection-scheduler-read-model';

describe('canonical current-store operating settings', () => {
  it('restores each store mode, policy runtime, Profile and scheduler across A to B to A and coordinator reconstruction', () => {
    const h = createHarness();
    const activePolicies = [h.contextOne, h.contextTwo].map(context => seedActiveMission(h.repository, context).version.id);
    const bus = new ConfigurationBus(h.database);
    const stores = new StoreRepository(h.database);
    const buildCoordinator = () => {
      const sessions = new DurableStoreSessionGenerationAuthority({
        transaction: work => bus.transaction(work),
        read: storeId => { const value = bus.get(`store_session_generation:${storeId}`); return value === null ? undefined : Number(value); },
        write: (storeId, value) => bus.set(`store_session_generation:${storeId}`, String(value)),
      });
      for (const store of stores.listStores()) sessions.seed(store.storeId, 4);
      return new StoreCoordinator({ repository: stores, sessions, now: () => new Date(NOW), selectionStorage: {
        read: () => { const value = bus.get('operator_workspace_selection'); return value ? JSON.parse(value) : null; },
        write: value => bus.set('operator_workspace_selection', JSON.stringify(value)),
        clear: () => bus.delete('operator_workspace_selection'),
      } });
    };
    let coordinator = buildCoordinator();
    let config = new StoreRuntimeConfigService({ storeCoordinator: coordinator, settings: bus, now: () => NOW });
    for (const [index, original] of [h.contextOne, h.contextTwo].entries()) {
      const context = coordinator.switchStore(original.storeId).context;
      config.create(context, { values: { aiRecommendationsEnabled: true,
        collectionScheduleLocalTime: index ? '09:30' : '08:00', collectionLookbackDays: index ? 14 : 7,
        analysisWindowDays: 30, defaultTargetAcosPercent: 28, minimumRecommendationConfidencePercent: 72, evidenceRetentionDays: 365 } });
      const runtime = h.repository.getPolicyRuntime(context);
      h.repository.updatePolicyRuntime(context, { expectedRevision: runtime.revision, actorId: 'operator', patch: {
        autonomyMode: index ? 'policy_auto' : 'manual_approval', killSwitch: index === 0, circuitBreakerState: index ? 'closed' : 'open',
      } });
    }
    const manualRun = vi.fn(async () => { throw new Error('只读设置恢复不得触发采集'); });
    const resumeExisting = vi.fn(async () => { throw new Error('只读设置恢复不得触发恢复'); });
    const read = (storeId: typeof h.contextOne.storeId) => {
      const context = coordinator.switchStore(storeId).context;
      const scheduler = new StoreCollectionSchedulerReadModel({ authority: coordinator, runtimeConfig: config,
        automationControl: { get: current => readStoreCollectionAutomation(null, current) },
        importRepository: new LingxingImportRepository(h.database), orchestrator: { readProtectedSemanticAttempt: () => null },
        manualRun, resumeExisting, now: () => new Date(NOW) });
      return { profile: context.browserProfileId, runtime: h.repository.getPolicyRuntime(context),
        config: config.get(context).current, scheduler: scheduler.get(context) };
    };
    const a = read(h.contextOne.storeId);
    const b = read(h.contextTwo.storeId);
    expect(read(h.contextOne.storeId)).toEqual(a);
    expect(a.profile).toBe(h.contextOne.browserProfileId);
    expect(b.profile).toBe(h.contextTwo.browserProfileId);
    expect(a.runtime).toMatchObject({ storeId: h.contextOne.storeId, autonomyMode: 'manual_approval', killSwitch: true, circuitBreakerState: 'open', activePolicyVersionId: activePolicies[0] });
    expect(b.runtime).toMatchObject({ storeId: h.contextTwo.storeId, autonomyMode: 'policy_auto', killSwitch: false, circuitBreakerState: 'closed', activePolicyVersionId: activePolicies[1] });
    expect(a.scheduler).toMatchObject({ storeId: h.contextOne.storeId, scheduleLocalTime: '08:00', dateStart: '2026-07-15', dateEnd: '2026-07-21' });
    expect(b.scheduler).toMatchObject({ storeId: h.contextTwo.storeId, scheduleLocalTime: '09:30', dateStart: '2026-07-08', dateEnd: '2026-07-21' });
    coordinator = buildCoordinator();
    config = new StoreRuntimeConfigService({ storeCoordinator: coordinator, settings: bus, now: () => NOW });
    coordinator.restoreOperatorWorkspaceSelectionAfterRecovery();
    expect(coordinator.getActiveStoreContext()?.storeId).toBe(h.contextOne.storeId);
    expect(read(h.contextTwo.storeId)).toEqual(b);
    expect(read(h.contextOne.storeId)).toEqual(a);
    expect(manualRun).not.toHaveBeenCalled();
    expect(resumeExisting).not.toHaveBeenCalled();
  });
});
