import { describe, expect, it } from 'vitest';
import type {
  MissionControlCapabilityAction,
  MissionControlCapabilityProjection,
} from '@amazon-ai-ops/shared-types';
import { resolveLegacyRouteCapability } from './router';

const reportActions = [
  ['collection.reports.view', 'view'],
  ['collection.reports.start', 'start'],
  ['collection.reports.resume', 'resume'],
  ['collection.reports.cancel', 'pause'],
  ['collection.reports.import', 'import'],
  ['collection.reports.open-artifact', 'view'],
] as const satisfies ReadonlyArray<readonly [string, MissionControlCapabilityAction]>;

function reportCapabilities(
  state: MissionControlCapabilityProjection['state'] = 'LEGACY_ADAPTER',
): MissionControlCapabilityProjection[] {
  return reportActions.map(([capabilityId, action]) => ({
    capabilityId,
    workspace: 'collection',
    view: 'collection/reports',
    action,
    state,
    legacyRoute: 'data-collection',
    detail: capabilityId,
  }));
}

const intent = { workspace: 'collection', subview: 'reports' } as const;
const schedulerIntent = { workspace: 'settings', subview: 'scheduler' } as const;

function schedulerCapabilities(): MissionControlCapabilityProjection[] {
  return [
    {
      capabilityId: 'settings.scheduler.view',
      workspace: 'settings',
      view: 'settings/scheduler',
      action: 'view',
      state: 'LEGACY_ADAPTER',
      legacyRoute: 'scheduler',
      detail: 'compatibility view',
    },
    {
      capabilityId: 'settings.scheduler.run-now',
      workspace: 'settings',
      view: 'settings/scheduler',
      action: 'start',
      state: 'PRODUCTION_NATIVE',
      detail: 'store context run-now',
    },
    {
      capabilityId: 'settings.scheduler.retention-preview',
      workspace: 'settings',
      view: 'settings/scheduler',
      action: 'view',
      state: 'PRODUCTION_NATIVE',
      detail: 'retention dry-run',
    },
  ];
}

describe('resolveLegacyRouteCapability', () => {
  it('mounts the collection adapter only when every exact real action is authorized', () => {
    expect(resolveLegacyRouteCapability(
      reportCapabilities(),
      'data-collection',
      intent,
    )).toMatchObject({
      capabilityId: 'collection.reports.view',
      state: 'LEGACY_ADAPTER',
    });
  });

  it('fails the whole collection route closed when one mutation capability is missing', () => {
    const capability = resolveLegacyRouteCapability(
      reportCapabilities().filter((item) => item.capabilityId !== 'collection.reports.cancel'),
      'data-collection',
      intent,
    );

    expect(capability).toMatchObject({
      state: 'BLOCKED',
      blockerCode: 'EXACT_LEGACY_ACTION_CAPABILITIES_MISSING',
    });
    expect(capability?.detail).toContain('collection.reports.cancel');
  });

  it('keeps an explicitly isolated prototype route available without production mutation grants', () => {
    expect(resolveLegacyRouteCapability(
      reportCapabilities('PROTOTYPE_ONLY').slice(0, 1),
      'data-collection',
      intent,
      true,
    )).toMatchObject({
      state: 'PROTOTYPE_ONLY',
    });
  });

  it('mounts the scheduler compatibility view only with both exact native operations', () => {
    expect(resolveLegacyRouteCapability(
      schedulerCapabilities(),
      'scheduler',
      schedulerIntent,
    )).toMatchObject({
      capabilityId: 'settings.scheduler.view',
      state: 'LEGACY_ADAPTER',
    });

    const incomplete = resolveLegacyRouteCapability(
      schedulerCapabilities().filter((item) => item.capabilityId !== 'settings.scheduler.retention-preview'),
      'scheduler',
      schedulerIntent,
    );
    expect(incomplete).toMatchObject({
      state: 'BLOCKED',
      blockerCode: 'EXACT_LEGACY_ACTION_CAPABILITIES_MISSING',
    });
    expect(incomplete?.detail).toContain('settings.scheduler.retention-preview');
  });
});
