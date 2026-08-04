import {
  normalizeStoreContextEnvelope,
  type PolicyAutonomyMode,
  type PolicyRuntimeRecord,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { MissionDomainRepository } from '@amazon-ai-ops/local-db';
import type { StoreCoordinator } from './store-coordinator';
import type { StoreScopedObjectMutation } from './store-scoped-objects-ipc';

export const MISSION_DOMAIN_OPERATIONS = [
  'policies.create', 'policies.get', 'policies.list', 'policies.update',
  'policies.disable', 'policies.archive', 'policies.restore',
  'policyVersions.create', 'policyVersions.get', 'policyVersions.list',
  'policyVersions.updateDraft', 'policyVersions.enable',
  'policyRuntime.get', 'policyRuntime.setAutonomyMode', 'policyRuntime.setKillSwitch',
  'missions.create', 'missions.get', 'missions.list', 'missions.update',
  'missions.transition', 'missions.archive', 'missions.restore',
  'missions.appendCheckpoint', 'missions.listCheckpoints', 'missions.getLineage',
  'grants.get', 'grants.list', 'grants.listEvents', 'grants.revokeHuman',
  'decisions.create', 'decisions.get', 'decisions.list', 'decisions.revise',
  'decisions.resolveHuman', 'decisions.history',
  'experiments.create', 'experiments.get', 'experiments.list',
  'experiments.update', 'experiments.transition', 'experiments.archive',
  'experiments.restore', 'experiments.listObservations',
  'experiments.listMetricSnapshots', 'experiments.appendObservation',
  'causal.listEvents', 'causal.appendEvent',
] as const;

export type MissionDomainOperation = (typeof MISSION_DOMAIN_OPERATIONS)[number];

type MissionDomainRepositoryPort = Pick<MissionDomainRepository,
  | 'createPolicy' | 'getPolicy' | 'listPolicies' | 'updatePolicy'
  | 'disablePolicy' | 'archivePolicy' | 'restorePolicy'
  | 'createPolicyVersion' | 'getPolicyVersion' | 'listPolicyVersions'
  | 'updateDraftPolicyVersion' | 'enablePolicyVersion'
  | 'getPolicyRuntime' | 'updatePolicyRuntime'
  | 'createMission' | 'getMission' | 'listMissions' | 'updateMission'
  | 'transitionMission' | 'archiveMission' | 'restoreMission'
  | 'appendMissionCheckpoint' | 'listMissionCheckpoints'
  | 'appendMissionLink' | 'getMissionLineage'
  | 'getMissionGrant' | 'listMissionGrants' | 'listMissionGrantEvents'
  | 'appendMissionGrantEvent'
  | 'createDecision' | 'getDecision' | 'listDecisions' | 'reviseDecision'
  | 'resolveDecision' | 'listDecisionHistory'
  | 'createExperiment' | 'getExperiment' | 'listExperiments'
  | 'updateExperiment' | 'transitionExperiment' | 'archiveExperiment'
  | 'restoreExperiment' | 'listExperimentObservations'
  | 'listExperimentMetricSnapshots' | 'appendExperimentObservation'
  | 'appendExperimentMetricSnapshot'
  | 'appendCausalEvent' | 'listCausalEvents' | 'appendCausalLink'
  | 'appendEvidenceRef'
>;

export interface MissionDomainServiceOptions {
  repository: MissionDomainRepositoryPort;
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext'>;
}

export interface AutonomyProjection {
  mode: PolicyAutonomyMode;
  killSwitch: boolean;
  circuitBreakerState: PolicyRuntimeRecord['circuitBreakerState'];
  activePolicyVersionId?: string;
  revision: number;
  canAutoExecute: boolean;
  status: 'APPLIED';
}

export interface SetAutonomyModeInput {
  expectedRevision: number;
  mode: PolicyAutonomyMode;
  reason?: string;
}

export interface SetKillSwitchInput {
  expectedRevision: number;
  enabled: boolean;
  reason?: string;
}

const OPERATOR_ACTOR = 'operator';
const POLICY_ACTOR = 'policy-engine';

/**
 * Main-only authority boundary for Mission Control's durable domain.
 *
 * Renderer input is never trusted as store, actor, policy issuer, or runtime
 * authority. Every operation validates the complete captured context both
 * immediately before and immediately after the synchronous repository call.
 */
export class MissionDomainService {
  private readonly repository: MissionDomainRepositoryPort;
  private readonly storeCoordinator: MissionDomainServiceOptions['storeCoordinator'];

  constructor(options: MissionDomainServiceOptions) {
    this.repository = options.repository;
    this.storeCoordinator = options.storeCoordinator;
  }

  executeOperation(
    operation: MissionDomainOperation,
    contextInput: StoreContextEnvelope,
    rawInput: unknown,
  ): unknown {
    const input = rendererInput(rawInput);
    switch (operation) {
      case 'policies.create': return this.run(contextInput, (c) => this.repository.createPolicy(c, withActor(input) as never));
      case 'policies.get': return this.run(contextInput, (c) => this.repository.getPolicy(c, requiredId(input)));
      case 'policies.list': return this.run(contextInput, (c) => this.repository.listPolicies(c, input));
      case 'policies.update': return this.run(contextInput, (c) => this.repository.updatePolicy(c, withActor(input) as never));
      case 'policies.disable': return this.run(contextInput, (c) => this.repository.disablePolicy(c, withActor(input) as never));
      case 'policies.archive': return this.run(contextInput, (c) => this.repository.archivePolicy(c, withActor(input) as never));
      case 'policies.restore': return this.run(contextInput, (c) => this.repository.restorePolicy(c, withActor(input) as never));

      case 'policyVersions.create': return this.run(contextInput, (c) => this.repository.createPolicyVersion(c, withActor(input) as never));
      case 'policyVersions.get': return this.run(contextInput, (c) => this.repository.getPolicyVersion(c, requiredId(input)));
      case 'policyVersions.list': return this.run(contextInput, (c) => this.repository.listPolicyVersions(c, requiredString(input, 'policyId')));
      case 'policyVersions.updateDraft': return this.run(contextInput, (c) => this.repository.updateDraftPolicyVersion(c, withActor(input) as never));
      case 'policyVersions.enable': return this.run(contextInput, (c) => this.repository.enablePolicyVersion(c, withActor(input) as never));

      case 'policyRuntime.get': return this.getAutonomyProjection(contextInput);
      case 'policyRuntime.setAutonomyMode': return this.setAutonomyMode(contextInput, input as unknown as SetAutonomyModeInput);
      case 'policyRuntime.setKillSwitch': return this.setKillSwitch(contextInput, input as unknown as SetKillSwitchInput);

      case 'missions.create': return this.run(contextInput, (c) => this.repository.createMission(c, withActor(input) as never));
      case 'missions.get': return this.run(contextInput, (c) => this.repository.getMission(c, requiredId(input)));
      case 'missions.list': return this.run(contextInput, (c) => this.repository.listMissions(c, input));
      case 'missions.update': return this.run(contextInput, (c) => this.repository.updateMission(c, withActor(input) as never));
      case 'missions.transition': return this.run(contextInput, (c) => this.repository.transitionMission(c, withActor(input) as never));
      case 'missions.archive': return this.run(contextInput, (c) => this.repository.archiveMission(c, withActor(input) as never));
      case 'missions.restore': return this.run(contextInput, (c) => this.repository.restoreMission(c, withActor(input) as never));
      case 'missions.appendCheckpoint': {
        const stage = requiredString(input, 'stage');
        if (!['FACT', 'ANALYSIS'].includes(stage)) {
          throw new TypeError('Renderer may append only FACT or ANALYSIS Mission checkpoints.');
        }
        return this.run(contextInput, (c) => this.repository.appendMissionCheckpoint(c, withActor(input) as never));
      }
      case 'missions.listCheckpoints': return this.run(contextInput, (c) => this.repository.listMissionCheckpoints(c, requiredString(input, 'missionId')));
      case 'missions.getLineage': return this.run(contextInput, (c) => this.repository.getMissionLineage(c, requiredString(input, 'missionId')));

      case 'grants.get': return this.run(contextInput, (c) => this.repository.getMissionGrant(c, requiredId(input)));
      case 'grants.list': return this.run(contextInput, (c) => this.repository.listMissionGrants(c, requiredString(input, 'missionId')));
      case 'grants.listEvents': return this.run(contextInput, (c) => this.repository.listMissionGrantEvents(c, requiredString(input, 'missionId')));
      case 'grants.revokeHuman': return this.run(contextInput, (c) => this.repository.appendMissionGrantEvent(c, {
        ...input, eventType: 'revoked', actorId: OPERATOR_ACTOR,
      } as never));
      case 'decisions.create': return this.run(contextInput, (c) => this.repository.createDecision(c, withActor(input) as never));
      case 'decisions.get': return this.run(contextInput, (c) => this.repository.getDecision(c, requiredId(input)));
      case 'decisions.list': return this.run(contextInput, (c) => this.repository.listDecisions(c, input));
      case 'decisions.revise': return this.run(contextInput, (c) => this.repository.reviseDecision(c, withActor(input) as never));
      case 'decisions.resolveHuman': {
        const status = requiredString(input, 'status');
        if (!['approved', 'rejected', 'blocked', 'superseded'].includes(status)) {
          throw new TypeError('Renderer may resolve Decisions only as approved, rejected, blocked, or superseded.');
        }
        return this.run(contextInput, (c) => this.repository.resolveDecision(c, withActor(input) as never));
      }
      case 'decisions.history': return this.run(contextInput, (c) => this.repository.listDecisionHistory(c, requiredString(input, 'decisionId')));

      case 'experiments.create': return this.run(contextInput, (c) => this.repository.createExperiment(c, input as never));
      case 'experiments.get': return this.run(contextInput, (c) => this.repository.getExperiment(c, requiredId(input)));
      case 'experiments.list': return this.run(contextInput, (c) => this.repository.listExperiments(c, input));
      case 'experiments.update': return this.run(contextInput, (c) => this.repository.updateExperiment(c, withActor(input) as never));
      case 'experiments.transition': return this.run(contextInput, (c) => this.repository.transitionExperiment(c, withActor(input) as never));
      case 'experiments.archive': return this.run(contextInput, (c) => this.repository.archiveExperiment(c, withActor(input) as never));
      case 'experiments.restore': return this.run(contextInput, (c) => this.repository.restoreExperiment(c, withActor(input) as never));
      case 'experiments.listObservations': return this.run(contextInput, (c) => this.repository.listExperimentObservations(c, requiredString(input, 'experimentId')));
      case 'experiments.listMetricSnapshots': return this.run(contextInput, (c) => this.repository.listExperimentMetricSnapshots(c, requiredString(input, 'experimentId')));
      case 'experiments.appendObservation': return this.run(contextInput, (c) => this.repository.appendExperimentObservation(c, withActor(input) as never));
      case 'causal.listEvents': return this.run(contextInput, (c) => this.repository.listCausalEvents(c, input as never));
      case 'causal.appendEvent': {
        const stage = requiredString(input, 'stage');
        if (!['FACT', 'ANALYSIS'].includes(stage)) {
          throw new TypeError('Renderer cannot append ACTION, READBACK, EFFECT, or DECISION ledger events.');
        }
        return this.run(contextInput, (c) => this.repository.appendCausalEvent(c, {
          ...input, source: 'mission-domain-ui', actorId: OPERATOR_ACTOR,
        } as never));
      }
      default:
        throw new TypeError(`Unsupported Mission domain operation: ${String(operation)}`);
    }
  }

  getAutonomyProjection(contextInput: StoreContextEnvelope): AutonomyProjection {
    const runtime = this.runRaw(contextInput, (context) => this.repository.getPolicyRuntime(context));
    return {
      mode: runtime.autonomyMode,
      killSwitch: runtime.killSwitch,
      circuitBreakerState: runtime.circuitBreakerState,
      activePolicyVersionId: runtime.activePolicyVersionId,
      revision: runtime.revision,
      canAutoExecute: !runtime.killSwitch
        && runtime.circuitBreakerState === 'closed'
        && Boolean(runtime.activePolicyVersionId),
      status: 'APPLIED',
    };
  }

  setAutonomyMode(
    contextInput: StoreContextEnvelope,
    input: SetAutonomyModeInput,
  ): AutonomyProjection {
    rendererInput(input);
    this.runRaw(contextInput, (context) => this.repository.updatePolicyRuntime(context, {
      expectedRevision: input.expectedRevision,
      actorId: OPERATOR_ACTOR,
      patch: {
        autonomyMode: input.mode,
        reason: input.reason ?? `operator_set_${input.mode}`,
      },
    }));
    return this.getAutonomyProjection(contextInput);
  }

  setKillSwitch(
    contextInput: StoreContextEnvelope,
    input: SetKillSwitchInput,
  ): AutonomyProjection {
    rendererInput(input);
    if (typeof input.enabled !== 'boolean') {
      throw new TypeError('enabled must be a boolean.');
    }
    const clearReason = input.enabled ? undefined : input.reason?.trim();
    if (!input.enabled && !clearReason) {
      throw new TypeError('Clearing the kill switch requires an explicit review reason.');
    }
    this.runRaw(contextInput, (context) => {
      const runtime = this.repository.getPolicyRuntime(context);
      return this.repository.updatePolicyRuntime(context, {
        expectedRevision: input.expectedRevision,
        actorId: OPERATOR_ACTOR,
        patch: {
          killSwitch: input.enabled,
          // Emergency stop must be a single durable write even when the store
          // was in policy-auto. Disabling it never silently restores auto.
          autonomyMode: input.enabled ? 'manual_approval' : runtime.autonomyMode,
          reason: (input.enabled ? input.reason : clearReason) ?? (input.enabled
            ? 'operator_enabled_kill_switch'
            : 'operator_disabled_kill_switch'),
        },
      });
    });
    return this.getAutonomyProjection(contextInput);
  }

  appendMissionLinkInternal(contextInput: StoreContextEnvelope, input: unknown): unknown {
    const value = rendererInput(input);
    return this.run(contextInput, (context) => this.repository.appendMissionLink(context, {
      ...value,
      actorId: POLICY_ACTOR,
    } as never));
  }

  appendCausalLinkInternal(contextInput: StoreContextEnvelope, input: unknown): unknown {
    const value = rendererInput(input);
    return this.run(contextInput, (context) =>
      this.repository.appendCausalLink(context, value as never));
  }

  appendMissionCheckpointInternal(contextInput: StoreContextEnvelope, input: unknown): unknown {
    const value = rendererInput(input);
    return this.run(contextInput, (context) => this.repository.appendMissionCheckpoint(context, {
      ...value,
      actorId: POLICY_ACTOR,
    } as never));
  }

  updatePolicyRuntimeInternal(contextInput: StoreContextEnvelope, input: unknown): unknown {
    const value = rendererInput(input);
    return this.run(contextInput, (context) => this.repository.updatePolicyRuntime(context, {
      ...value,
      actorId: POLICY_ACTOR,
    } as never));
  }

  appendExperimentMetricSnapshotInternal(
    contextInput: StoreContextEnvelope,
    input: unknown,
  ): unknown {
    const value = rendererInput(input);
    return this.run(contextInput, (context) =>
      this.repository.appendExperimentMetricSnapshot(context, value as never));
  }

  appendEvidenceRefInternal(contextInput: StoreContextEnvelope, input: unknown): unknown {
    const value = rendererInput(input);
    return this.run(contextInput, (context) => this.repository.appendEvidenceRef(context, value as never));
  }

  resolveDecisionInternal(contextInput: StoreContextEnvelope, input: unknown): unknown {
    const value = rendererInput(input);
    return this.run(contextInput, (context) => this.repository.resolveDecision(context, {
      ...value,
      actorId: POLICY_ACTOR,
    } as never));
  }

  /**
   * Synchronous post-write hook for StoreScopedObjects IPC.
   * If ledger persistence fails, this method throws and the originating IPC
   * call fails closed instead of silently reporting an untracked mutation.
   */
  recordOperationEventMutation(
    contextInput: StoreContextEnvelope,
    mutation: StoreScopedObjectMutation,
  ): unknown {
    if (mutation.entityType !== 'operation_event') return undefined;
    const record = rendererInput(mutation.record);
    const id = requiredString(record, 'id');
    const revision = requiredString(record, 'revision');
    const recordStoreId = optionalString(record, 'storeId') ?? optionalString(record, 'store_id');
    const context = normalizeStoreContextEnvelope(contextInput);
    if (recordStoreId && recordStoreId !== context.storeId) {
      throw new TypeError('Operation-event mutation store does not match the authoritative context.');
    }
    return this.run(context, (authorized) => this.repository.appendCausalEvent(authorized, {
      id: `causal:operation-event:${id}:${revision}:${mutation.action}`.slice(0, 160),
      stage: 'FACT',
      eventType: `operation_event_${mutation.action}`,
      entityType: 'operation_event',
      entityId: id,
      title: optionalString(record, 'title') ?? `Operation event ${id}`,
      signal: optionalString(record, 'notes'),
      status: mutation.action,
      source: 'operator',
      actorId: OPERATOR_ACTOR,
    }));
  }

  private run<T>(
    contextInput: StoreContextEnvelope,
    operation: (context: StoreContextEnvelope) => T,
  ): T {
    return projectRendererValue(this.runRaw(contextInput, operation)) as T;
  }

  private runRaw<T>(
    contextInput: StoreContextEnvelope,
    operation: (context: StoreContextEnvelope) => T,
  ): T {
    const context = this.storeCoordinator.assertActiveStoreContext(contextInput);
    const value = operation(context);
    this.storeCoordinator.assertActiveStoreContext(context);
    return value;
  }
}

function withActor(input: Record<string, unknown>): Record<string, unknown> {
  return { ...input, actorId: OPERATOR_ACTOR };
}

function rendererInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Mission domain input must be an object.');
  }
  assertSafeValue(value, new WeakSet<object>());
  return value as Record<string, unknown>;
}

function assertSafeValue(value: unknown, visited: WeakSet<object>): void {
  if (typeof value === 'string') {
    if (containsLocalFilesystemReference(value)) {
      throw new TypeError('Filesystem paths and file URIs are forbidden in Mission domain DTOs.');
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) throw new TypeError('Mission domain DTOs must not be cyclic.');
  visited.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (/password|secret|cookie|access.?token|refresh.?token|local.?path|file.?path|evidence.?path|profile.?path/i.test(key)) {
      throw new TypeError(`Sensitive or local-only field ${key} is forbidden in Mission domain DTOs.`);
    }
    assertSafeValue(child, visited);
  }
  visited.delete(value);
}

function projectRendererValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectRendererValue);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string'
      && containsLocalFilesystemReference(value)) {
      throw new TypeError('Main refused to expose a local filesystem path through Mission domain IPC.');
    }
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/password|secret|cookie|access.?token|refresh.?token|local.?path|file.?path|evidence.?path|profile.?path/i.test(key)) {
      throw new TypeError(`Main refused to expose local-only field ${key} through Mission domain IPC.`);
    }
    if (key === 'actorId') {
      output[key] = child === POLICY_ACTOR ? POLICY_ACTOR : OPERATOR_ACTOR;
    } else if (key === 'issuer' && child && typeof child === 'object' && !Array.isArray(child)) {
      const type = (child as { type?: unknown }).type === 'policy' ? 'policy' : 'human';
      output[key] = { type, actorId: type === 'policy' ? POLICY_ACTOR : OPERATOR_ACTOR };
    } else {
      output[key] = projectRendererValue(child);
    }
  }
  return output;
}

function containsLocalFilesystemReference(value: string): boolean {
  return /(?:\bfile:(?:\/{2,}|\\{2,})|\b[A-Za-z]:[\\/]|\\\\[^\\/\s"'<>]+[\\/])/i.test(value);
}

function requiredId(input: Record<string, unknown>): string {
  return requiredString(input, 'id');
}

function requiredString(input: Record<string, unknown>, key: string): string {
  return requiredLogicalId(input[key], key);
}

function requiredLogicalId(value: unknown, key: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError(`${key} is required.`);
  const normalized = String(value).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) {
    throw new TypeError(`${key} must be an opaque logical identifier.`);
  }
  return normalized;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
