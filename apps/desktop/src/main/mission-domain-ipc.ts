import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { MissionDomainOperation, MissionDomainService } from './mission-domain-service';

export const MISSION_DOMAIN_IPC_ROUTES = Object.freeze({
  'mission-domain:policies:create': 'policies.create',
  'mission-domain:policies:get': 'policies.get',
  'mission-domain:policies:list': 'policies.list',
  'mission-domain:policies:update': 'policies.update',
  'mission-domain:policies:disable': 'policies.disable',
  'mission-domain:policies:archive': 'policies.archive',
  'mission-domain:policies:restore': 'policies.restore',
  'mission-domain:policy-versions:create': 'policyVersions.create',
  'mission-domain:policy-versions:get': 'policyVersions.get',
  'mission-domain:policy-versions:list': 'policyVersions.list',
  'mission-domain:policy-versions:update-draft': 'policyVersions.updateDraft',
  'mission-domain:policy-versions:enable': 'policyVersions.enable',
  'mission-domain:policy-runtime:get': 'policyRuntime.get',
  'mission-domain:policy-runtime:set-autonomy-mode': 'policyRuntime.setAutonomyMode',
  'mission-domain:policy-runtime:set-kill-switch': 'policyRuntime.setKillSwitch',
  'mission-domain:missions:create': 'missions.create',
  'mission-domain:missions:get': 'missions.get',
  'mission-domain:missions:list': 'missions.list',
  'mission-domain:missions:update': 'missions.update',
  'mission-domain:missions:transition': 'missions.transition',
  'mission-domain:missions:archive': 'missions.archive',
  'mission-domain:missions:restore': 'missions.restore',
  'mission-domain:missions:append-checkpoint': 'missions.appendCheckpoint',
  'mission-domain:missions:list-checkpoints': 'missions.listCheckpoints',
  'mission-domain:missions:get-lineage': 'missions.getLineage',
  'mission-domain:grants:issue-human': 'grants.issueHuman',
  'mission-domain:grants:get': 'grants.get',
  'mission-domain:grants:list': 'grants.list',
  'mission-domain:grants:list-events': 'grants.listEvents',
  'mission-domain:grants:revoke-human': 'grants.revokeHuman',
  'mission-domain:decisions:create': 'decisions.create',
  'mission-domain:decisions:get': 'decisions.get',
  'mission-domain:decisions:list': 'decisions.list',
  'mission-domain:decisions:revise': 'decisions.revise',
  'mission-domain:decisions:resolve-human': 'decisions.resolveHuman',
  'mission-domain:decisions:history': 'decisions.history',
  'mission-domain:experiments:create': 'experiments.create',
  'mission-domain:experiments:get': 'experiments.get',
  'mission-domain:experiments:list': 'experiments.list',
  'mission-domain:experiments:update': 'experiments.update',
  'mission-domain:experiments:transition': 'experiments.transition',
  'mission-domain:experiments:archive': 'experiments.archive',
  'mission-domain:experiments:restore': 'experiments.restore',
  'mission-domain:experiments:list-observations': 'experiments.listObservations',
  'mission-domain:experiments:list-metric-snapshots': 'experiments.listMetricSnapshots',
  'mission-domain:experiments:append-observation': 'experiments.appendObservation',
  'mission-domain:causal:list-events': 'causal.listEvents',
  'mission-domain:causal:append-event': 'causal.appendEvent',
} satisfies Record<string, MissionDomainOperation>);

export const MISSION_DOMAIN_IPC_CHANNELS = Object.freeze(
  Object.keys(MISSION_DOMAIN_IPC_ROUTES) as Array<keyof typeof MISSION_DOMAIN_IPC_ROUTES>,
);

export interface MissionDomainIpcRegistrar {
  handle(channel: string, listener: (event: unknown, request?: unknown) => unknown): void;
}

type MissionDomainServicePort = Pick<MissionDomainService, 'executeOperation'>;

export function registerMissionDomainIpcHandlers(
  ipc: MissionDomainIpcRegistrar,
  service: MissionDomainServicePort,
): void {
  for (const channel of MISSION_DOMAIN_IPC_CHANNELS) {
    const operation = MISSION_DOMAIN_IPC_ROUTES[channel];
    ipc.handle(channel, (_event, rawRequest) => {
      const request = readRequest(rawRequest);
      return service.executeOperation(operation, request.storeContext, request.input);
    });
  }
}

function readRequest(value: unknown): {
  storeContext: StoreContextEnvelope;
  input: Record<string, unknown>;
} {
  const request = asObject(value, 'Mission domain IPC request');
  const keys = Object.keys(request);
  if (keys.some((key) => key !== 'storeContext' && key !== 'input')) {
    throw new TypeError('Mission domain IPC request accepts only storeContext and input.');
  }
  if (!Object.prototype.hasOwnProperty.call(request, 'storeContext')
    || !Object.prototype.hasOwnProperty.call(request, 'input')) {
    throw new TypeError('Mission domain IPC request requires storeContext and input.');
  }
  return {
    storeContext: asObject(request.storeContext, 'storeContext') as unknown as StoreContextEnvelope,
    input: asObject(request.input, 'input'),
  };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
