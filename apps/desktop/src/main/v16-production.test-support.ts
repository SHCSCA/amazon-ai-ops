// Isolated service integration. Reports, AI and browser ports are fixture inputs; this is not real-store canary evidence.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { BrowserLeaseManager, deriveStoreCapsulePaths, ensureStoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import { AiCallLogRepository, ExecutionAuthorityRepository } from '@amazon-ai-ops/local-db';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { V16_API_VERSION, type V16Result } from '@amazon-ai-ops/shared-types/src/v16-api';
import { createHarness, createHarnessAsync, type Harness, NOW } from './analysis-authority.test-support';
import { FakeExecutionPage } from './execution-browser.test-support';
import { MissionDomainService } from './mission-domain-service';
import { ExecutionAuthorityService } from './execution-authority-service';
import { registerV16ServicesIpc } from './v16-services-ipc';
import { createV16ServicesPreloadApi } from '../preload/v16-services-preload';
export function workflow(mode: 'manual_approval' | 'policy_auto' = 'manual_approval', count = 1,
  importReports?: NonNullable<Parameters<typeof createHarness>[0]>['importReports'],
  options: Pick<NonNullable<Parameters<typeof createHarness>[0]>, 'now' | 'reportDateEnd'> = {}) {
  const h = createHarness({ autonomyMode: mode, recommendationCount: count, importReports, ...options });
  return workflowFromHarness(h);
}
export async function workflowAsync(mode: 'manual_approval' | 'policy_auto', count: number,
  importReports: Parameters<typeof createHarnessAsync>[0]['importReports'],
  options: Pick<NonNullable<Parameters<typeof createHarness>[0]>, 'now' | 'reportDateEnd'> = {}) {
  return workflowFromHarness(await createHarnessAsync({ autonomyMode: mode, recommendationCount: count, importReports, ...options }));
}
function workflowFromHarness(h: Harness) {
  h.database.prepare("INSERT INTO store_connections (id, store_id, provider, status, external_account_id, normalized_external_account_id, created_at, updated_at) VALUES ('connection-ads', 'store-one', 'amazon_ads', 'ready', 'ads-account-1', 'ads-account-1', ?, ?)").run(NOW, NOW);
  h.database.prepare("UPDATE store_session_metadata SET external_account_id = 'ads-account-1' WHERE store_id = 'store-one' AND provider = 'amazon_ads'").run();
  const coordinator = { assertActiveStoreContext: (input: unknown) => {
    const normalized = normalizeStoreContextEnvelope(input);
    if (JSON.stringify(normalized) !== JSON.stringify(h.context)) throw new Error('Store context changed'); return h.context;
  }, getActiveStoreContext: () => h.context };
  const domain = new MissionDomainService({ repository: h.missionRepository, storeCoordinator: coordinator,
    aiCalls: new AiCallLogRepository(h.database, () => new Date(NOW)) });
  const repository = new ExecutionAuthorityRepository(h.database, { now: () => new Date(NOW) });
  const page = new FakeExecutionPage(); page.keywordId = 'opaque-keyword-1'; page.allowAfterScreenshot();
  const capsule = ensureStoreCapsulePaths(deriveStoreCapsulePaths(path.join(h.directory, 'trusted-stores'), h.context.storeId, h.context.browserProfileId));
  const execution = new ExecutionAuthorityService({ repository, missionRepository: h.missionRepository, analysisRepository: h.analysisRepository,
    storeCoordinator: coordinator, leases: new BrowserLeaseManager(() => new Date(NOW).getTime()), now: () => new Date(NOW),
    policyDispatchSuppression: { isPolicyDispatchSuppressed: () => false },
    resolveBrowserRuntime: () => ({ context: h.context, externalAccountId: 'ads-account-1', page, capsule, bringToFront: async () => {},
      navigate: async url => page.selectCampaign(new URL(url).searchParams.get('id') ?? 'campaign-1') }),
  });
  const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
  registerV16ServicesIpc({ handle: (name, handler) => handlers.set(name, handler) }, { domain, analysis: h.service, execution, storeCoordinator: coordinator });
  const api = createV16ServicesPreloadApi({ invoke: async (channel, request) => handlers.get(channel)!(undefined, request) });
  return { ...h, page, api, execution, request: <T,>(input: T) => ({ apiVersion: V16_API_VERSION, storeContext: h.context, input }) };
}
export function success<T>(result: V16Result<T>): T { expect(result, JSON.stringify(result)).toHaveProperty('success', true); if (!result.success) throw new Error(result.error); return result.data; }

export async function approveHumanBatch(h: ReturnType<typeof workflow>): Promise<void> {
  const decisions = success(await h.api.decisionList(h.request({ missionId: h.missionId })));
  for (const decision of decisions.filter(item => item.status === 'needs_approval')) {
    success(await h.api.decisionResolve(h.request({ id: decision.id, expectedRevision: decision.revision,
      status: 'approved', reason: `隔离人工验收样本：核对 ${decision.title} 的花费与证据，接受本条降价。` })));
  }
}
