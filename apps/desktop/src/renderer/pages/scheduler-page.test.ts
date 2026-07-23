import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type MissionControlCapabilityProjection,
  type StoreCollectionScheduleProjection,
} from '@amazon-ai-ops/shared-types';
import {
  normalizeRetentionSummary,
  readStoreAutomationRendererApi,
  resolveStoreAutomationAccess,
  schedulerRunNowPolicy,
  storeAutomationRequestMatches,
  STORE_AUTOMATION_CAPABILITY_IDS,
  STORE_AUTOMATION_STATES,
} from './scheduler-page';

const context = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 4,
});

function projection(
  state: StoreCollectionScheduleProjection['state'],
): StoreCollectionScheduleProjection {
  return {
    storeId: context.storeId,
    businessDate: context.businessDate,
    enabled: !['not_configured', 'archived'].includes(state),
    state,
    detail: state,
    scheduleLocalTime: '08:00',
    configRevision: 3,
    dateStart: '2026-07-08',
    dateEnd: '2026-07-21',
  };
}

function capability(
  capabilityId: string,
  action: MissionControlCapabilityProjection['action'],
  state: MissionControlCapabilityProjection['state'],
  legacyRoute?: 'scheduler',
): MissionControlCapabilityProjection {
  return {
    capabilityId,
    workspace: 'settings',
    view: 'settings/scheduler',
    action,
    state,
    ...(legacyRoute ? { legacyRoute } : {}),
    detail: capabilityId,
  };
}

describe('store automation plan', () => {
  it('publishes all seven scheduler states in lifecycle order', () => {
    expect(STORE_AUTOMATION_STATES.map((item) => item.state)).toEqual([
      'not_configured',
      'archived',
      'waiting',
      'due',
      'claimed',
      'succeeded',
      'failed',
    ]);
  });

  it('allows run-now only before a terminal or claimed state', () => {
    expect(schedulerRunNowPolicy(projection('waiting')).allowed).toBe(true);
    expect(schedulerRunNowPolicy(projection('due')).allowed).toBe(true);
    expect(schedulerRunNowPolicy(projection('claimed')).allowed).toBe(false);
    expect(schedulerRunNowPolicy(projection('succeeded')).allowed).toBe(false);
    expect(schedulerRunNowPolicy(projection('failed'))).toEqual({
      allowed: false,
      reason: '同一店铺、业务日与采集口径已失败关闭且不重试；调整触发时间不会绕过幂等，只有回看窗口变化才会形成新 fingerprint。',
    });
  });

  it('guides missing and archived configurations instead of offering run-now', () => {
    expect(schedulerRunNowPolicy(projection('not_configured')).reason).toContain('AI 与本地设置');
    expect(schedulerRunNowPolicy(projection('archived')).reason).toContain('恢复配置');
  });
});

describe('store automation capability boundary', () => {
  const production = [
    capability(STORE_AUTOMATION_CAPABILITY_IDS.view, 'view', 'LEGACY_ADAPTER', 'scheduler'),
    capability(STORE_AUTOMATION_CAPABILITY_IDS.runNow, 'start', 'PRODUCTION_NATIVE'),
    capability(STORE_AUTOMATION_CAPABILITY_IDS.retentionPreview, 'view', 'PRODUCTION_NATIVE'),
  ];

  it('requires the compatibility view plus both exact native actions in production', () => {
    const access = resolveStoreAutomationAccess(production, false);
    expect(access.view.allowed).toBe(true);
    expect(access.runNow.allowed).toBe(true);
    expect(access.retentionPreview.allowed).toBe(true);

    const incomplete = resolveStoreAutomationAccess(production.slice(0, 2), false);
    expect(incomplete.view.allowed).toBe(true);
    expect(incomplete.runNow.allowed).toBe(true);
    expect(incomplete.retentionPreview.allowed).toBe(false);
  });

  it('accepts only explicitly PROTOTYPE_ONLY scheduler capabilities in DEV preview', () => {
    const preview = production.map((item) => ({
      ...item,
      state: 'PROTOTYPE_ONLY' as const,
      blockerCode: 'DEV_PREVIEW_ONLY',
    }));
    expect(resolveStoreAutomationAccess(preview, true)).toMatchObject({
      view: { allowed: true },
      runNow: { allowed: true },
      retentionPreview: { allowed: true },
    });
    expect(resolveStoreAutomationAccess(production, true).runNow.allowed).toBe(false);
  });
});

describe('retention summary boundary', () => {
  const safe = {
    schemaVersion: 1,
    mode: 'dry-run',
    deletionSupported: false,
    generatedAt: '2026-07-22T16:00:00.000Z',
    storeId: String(context.storeId),
    profileId: String(context.browserProfileId),
    marketplace: 'US',
    currency: 'USD',
    retentionDays: 365,
    cutoffAt: '2025-07-22T16:00:00.000Z',
    expiryBasis: 'mtime-before-cutoff',
    applyable: false,
    scanSafe: true,
    candidateCount: 3,
    candidateBytes: 2048,
    protectedScopeCount: 2,
    protectedFileCount: 1,
    blockerCount: 0,
    blockers: [],
  } as const;

  it('keeps only path-free counts and blocker detail in renderer state', () => {
    expect(normalizeRetentionSummary(safe, context)).toEqual({
      schemaVersion: 1,
      mode: 'dry-run',
      deletionSupported: false,
      generatedAt: safe.generatedAt,
      storeId: String(context.storeId),
      profileId: String(context.browserProfileId),
      marketplace: 'US',
      currency: 'USD',
      retentionDays: 365,
      cutoffAt: safe.cutoffAt,
      scanSafe: true,
      candidateCount: 3,
      candidateBytes: 2048,
      protectedCount: 3,
      blockers: [],
    });
  });

  it('fails closed on mutation support or cross-store projection', () => {
    expect(() => normalizeRetentionSummary({ ...safe, deletionSupported: true }, context))
      .toThrow(/dry-run|安全校验/);
    expect(() => normalizeRetentionSummary({ ...safe, applyable: true }, context))
      .toThrow(/dry-run|安全校验/);
    expect(() => normalizeRetentionSummary({ ...safe, scanSafe: false }, context))
      .toThrow(/dry-run|安全校验/);
    expect(() => normalizeRetentionSummary({ ...safe, blockerCount: 1 }, context))
      .toThrow(/dry-run|安全校验/);
    expect(() => normalizeRetentionSummary({ ...safe, storeId: 'store-two' }, context))
      .toThrow(/当前店铺|安全校验/);
  });
});

describe('store automation Renderer API', () => {
  it('requires the exact three StoreContext-only methods', () => {
    const api = {
      getStoreCollectionSchedule: vi.fn(),
      runStoreCollectionScheduleNow: vi.fn(),
      previewStoreEvidenceRetention: vi.fn(),
    };
    expect(readStoreAutomationRendererApi({ electronAPI: api })).toBe(api);
    expect(readStoreAutomationRendererApi({
      electronAPI: { ...api, previewStoreEvidenceRetention: undefined },
    })).toBeNull();
  });

  it('removes the old global cron CRUD and exposes no retention mutation method', () => {
    const source = readFileSync(new URL('./scheduler-page.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/getScheduledTasks|setTaskEnabled|runTaskNow/);
    expect(source).not.toMatch(/deleteStoreEvidence|applyStoreEvidence|retention:delete|retention:apply/);
    expect(source).toContain('runStoreCollectionScheduleNow');
    expect(source).toContain('previewStoreEvidenceRetention');
    expect(source).toContain('调整触发时间不会绕过幂等，只有回看窗口变化才会形成新 fingerprint');
    expect(source).toContain('onKeyDown={handleConfirmDialogKeyDown}');
    expect(source).toContain('data-confirm-initial');
    expect(source).toContain("event.key === 'Escape'");
    expect(source.match(/<TaskBanner\b/g)).toHaveLength(1);
  });

  it('resets retention busy state on every context sequence and ignores stale store responses', () => {
    const source = readFileSync(new URL('./scheduler-page.tsx', import.meta.url), 'utf8');
    const loadCurrentStore = source.match(
      /async function loadCurrentStore[\s\S]*?\n  }\n\n  useEffect/,
    )?.[0] ?? '';
    const contextEffect = source.match(
      /useEffect\(\(\) => \{[\s\S]*?void loadCurrentStore\(\);/,
    )?.[0] ?? '';

    expect(loadCurrentStore.indexOf('setRetentionLoading(false);')).toBeGreaterThan(-1);
    expect(loadCurrentStore.indexOf('setRetentionLoading(false);'))
      .toBeLessThan(loadCurrentStore.indexOf('if (!access.view.allowed)'));
    expect(contextEffect).toContain('setRetentionLoading(false);');
    expect(source.match(/isCurrentRequest\(sequence, key\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(storeAutomationRequestMatches(4, 5, 'store-one', 'store-two')).toBe(false);
    expect(storeAutomationRequestMatches(4, 5, 'store-one', 'store-one')).toBe(false);
    expect(storeAutomationRequestMatches(5, 5, 'store-two', 'store-two')).toBe(true);
  });
});
