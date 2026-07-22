import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

export interface MissionDomainIpcInvoker {
  invoke(channel: string, request: unknown): Promise<unknown>;
}

type ScopedCall = (storeContext: StoreContextEnvelope, input?: Record<string, unknown>) => Promise<unknown>;

export interface MissionDomainPreloadApi {
  readonly policies: Readonly<Record<'create' | 'get' | 'list' | 'update' | 'disable' | 'archive' | 'restore', ScopedCall>>;
  readonly policyVersions: Readonly<Record<'create' | 'get' | 'list' | 'updateDraft' | 'enable', ScopedCall>>;
  readonly policyRuntime: Readonly<Record<'get' | 'setAutonomyMode' | 'setKillSwitch', ScopedCall>>;
  readonly missions: Readonly<Record<'create' | 'get' | 'list' | 'update' | 'transition' | 'archive' | 'restore' | 'appendCheckpoint' | 'listCheckpoints' | 'getLineage', ScopedCall>>;
  readonly grants: Readonly<Record<'get' | 'list' | 'listEvents' | 'revokeHuman', ScopedCall>>;
  readonly decisions: Readonly<Record<'create' | 'get' | 'list' | 'revise' | 'resolveHuman' | 'history', ScopedCall>>;
  readonly experiments: Readonly<Record<
    'create' | 'get' | 'list' | 'update' | 'transition' | 'archive' | 'restore'
    | 'listObservations' | 'listMetricSnapshots' | 'appendObservation',
    ScopedCall
  >>;
  readonly causal: Readonly<Record<'listEvents' | 'appendEvent', ScopedCall>>;
}

/** A closed, deeply frozen bridge. Renderer callers cannot select channels. */
export function createMissionDomainPreloadApi(ipc: MissionDomainIpcInvoker): MissionDomainPreloadApi {
  const call = (channel: string): ScopedCall => (storeContext, input = {}) =>
    ipc.invoke(channel, { storeContext, input });

  return Object.freeze({
    policies: Object.freeze({
      create: call('mission-domain:policies:create'),
      get: call('mission-domain:policies:get'),
      list: call('mission-domain:policies:list'),
      update: call('mission-domain:policies:update'),
      disable: call('mission-domain:policies:disable'),
      archive: call('mission-domain:policies:archive'),
      restore: call('mission-domain:policies:restore'),
    }),
    policyVersions: Object.freeze({
      create: call('mission-domain:policy-versions:create'),
      get: call('mission-domain:policy-versions:get'),
      list: call('mission-domain:policy-versions:list'),
      updateDraft: call('mission-domain:policy-versions:update-draft'),
      enable: call('mission-domain:policy-versions:enable'),
    }),
    policyRuntime: Object.freeze({
      get: call('mission-domain:policy-runtime:get'),
      setAutonomyMode: call('mission-domain:policy-runtime:set-autonomy-mode'),
      setKillSwitch: call('mission-domain:policy-runtime:set-kill-switch'),
    }),
    missions: Object.freeze({
      create: call('mission-domain:missions:create'),
      get: call('mission-domain:missions:get'),
      list: call('mission-domain:missions:list'),
      update: call('mission-domain:missions:update'),
      transition: call('mission-domain:missions:transition'),
      archive: call('mission-domain:missions:archive'),
      restore: call('mission-domain:missions:restore'),
      appendCheckpoint: call('mission-domain:missions:append-checkpoint'),
      listCheckpoints: call('mission-domain:missions:list-checkpoints'),
      getLineage: call('mission-domain:missions:get-lineage'),
    }),
    grants: Object.freeze({
      get: call('mission-domain:grants:get'),
      list: call('mission-domain:grants:list'),
      listEvents: call('mission-domain:grants:list-events'),
      revokeHuman: call('mission-domain:grants:revoke-human'),
    }),
    decisions: Object.freeze({
      create: call('mission-domain:decisions:create'),
      get: call('mission-domain:decisions:get'),
      list: call('mission-domain:decisions:list'),
      revise: call('mission-domain:decisions:revise'),
      resolveHuman: call('mission-domain:decisions:resolve-human'),
      history: call('mission-domain:decisions:history'),
    }),
    experiments: Object.freeze({
      create: call('mission-domain:experiments:create'),
      get: call('mission-domain:experiments:get'),
      list: call('mission-domain:experiments:list'),
      update: call('mission-domain:experiments:update'),
      transition: call('mission-domain:experiments:transition'),
      archive: call('mission-domain:experiments:archive'),
      restore: call('mission-domain:experiments:restore'),
      listObservations: call('mission-domain:experiments:list-observations'),
      listMetricSnapshots: call('mission-domain:experiments:list-metric-snapshots'),
      appendObservation: call('mission-domain:experiments:append-observation'),
    }),
    causal: Object.freeze({
      listEvents: call('mission-domain:causal:list-events'),
      appendEvent: call('mission-domain:causal:append-event'),
    }),
  });
}
