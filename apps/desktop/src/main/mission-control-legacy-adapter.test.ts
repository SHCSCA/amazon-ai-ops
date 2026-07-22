import { describe, expect, it } from 'vitest';
import {
  MISSION_CONTROL_VIEW_IDS,
  normalizeMissionControlCommandRequest,
  normalizeMissionControlQueryRequest,
  normalizeStoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  createMissionControlLegacyAdapter,
  MISSION_CONTROL_CAPABILITIES,
} from './mission-control-legacy-adapter';

const context = normalizeStoreContextEnvelope({
  storeId: 'store-one',
  browserProfileId: 'profile-one',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 3,
});

describe('Mission Control legacy adapter', () => {
  it('projects every canonical view granularly without marking unscoped legacy handlers green', async () => {
    const adapter = createMissionControlLegacyAdapter();
    const request = normalizeMissionControlQueryRequest({
      query: 'workspace-bootstrap',
      requestId: 'bootstrap-1',
      contextEpoch: 4,
      context,
    });
    const response = await adapter.query(request, context);

    expect(new Set(response.data.capabilities.map((row) => row.view)))
      .toEqual(new Set(MISSION_CONTROL_VIEW_IDS));
    expect(new Set(response.data.capabilities.map((row) => row.capabilityId)).size)
      .toBe(response.data.capabilities.length);
    expect(response.data.capabilities.filter((row) => row.state === 'PRODUCTION_NATIVE')
      .map((row) => row.capabilityId)).toEqual([
        'objects.store.view',
        'objects.store.create',
        'objects.store.update',
        'objects.store.archive',
        'objects.store.restore',
        'objects.store.switch',
      ]);
    expect(response.data.capabilities.some((row) => row.state === 'LEGACY_ADAPTER')).toBe(false);
    expect(response.data.capabilities.some((row) => row.state === 'PROTOTYPE_ONLY')).toBe(false);
    expect(response.data.capabilities.find((row) => (
      row.view === 'objects/products' && row.action === 'view'
    ))).toEqual(expect.objectContaining({
      capabilityId: 'objects.products.view',
      state: 'BLOCKED',
    }));
    expect(response.data.capabilities
      .filter((row) => row.legacyRoute)
      .every((row) => row.state === 'BLOCKED'
        && row.blockerCode === 'STORE_SCOPED_LEGACY_ADAPTER_NOT_IMPLEMENTED')).toBe(true);
    expect(response.data.autonomy).toEqual(expect.objectContaining({
      currentMode: 'manual_approval',
      manualApprovalAvailable: true,
      policyAutoAvailable: false,
      policyAutoBlockerCode: 'POLICY_AUTO_AUTHORITY_NOT_IMPLEMENTED',
    }));
  });

  it('keeps policy auto blocked and treats manual approval as an idempotent no-op', async () => {
    const adapter = createMissionControlLegacyAdapter();
    const auto = await adapter.command(normalizeMissionControlCommandRequest({
      command: 'set-autonomy-mode',
      requestId: 'mode-auto',
      contextEpoch: 1,
      context,
      payload: { mode: 'policy_auto' },
    }), context);
    const manual = await adapter.command(normalizeMissionControlCommandRequest({
      command: 'set-autonomy-mode',
      requestId: 'mode-manual',
      contextEpoch: 1,
      context,
      payload: { mode: 'manual_approval' },
    }), context);

    expect(auto).toEqual(expect.objectContaining({
      status: 'BLOCKED',
      currentMode: 'manual_approval',
      blockerCode: 'POLICY_AUTO_AUTHORITY_NOT_IMPLEMENTED',
    }));
    expect(manual).toEqual(expect.objectContaining({
      status: 'NOOP',
      currentMode: 'manual_approval',
    }));
  });

  it('does not project secrets or filesystem paths', () => {
    const serialized = JSON.stringify(MISSION_CONTROL_CAPABILITIES);
    expect(serialized).not.toMatch(/password|cookie|token|apiKey|filePath|profilePath/i);
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});
