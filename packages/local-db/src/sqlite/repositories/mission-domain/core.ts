import  {
  normalizeStoreContextEnvelope,
  type CausalEventRecord,
  type DecisionRecord,
  type ExperimentObservationRecord,
  type ExperimentRecord,
  type MissionGrantRecord,
  type MissionLinkRecord,
  type MissionRecord,
  type MissionCheckpointRecord,
  type PolicyRecord,
  type PolicyVersionRecord,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import  {
  StoreAuthorityRow,
  MissionRow,
  PolicyRow,
  PolicyVersionRow,
  DecisionRow,
  ExperimentRow,
  GrantRow,
  CausalRow,
} from './contracts';
import  {
  idOf,
  revisionOf,
  notFound,
  isConstraint,
} from './values';
import  {
  mapPolicy,
  mapPolicyVersion,
  mapMission,
  mapMissionLink,
  mapMissionCheckpoint,
  mapDecision,
  mapExperiment,
  mapExperimentObservation,
  mapCausalEvent,
} from './rows';
import { MissionDomainRepositoryError } from './errors';
import type { MissionDomainRepositoryContext } from './context';
export function assertContext(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope): StoreContextEnvelope{
    let context: StoreContextEnvelope;
    try {
      context = normalizeStoreContextEnvelope(contextInput);
    } catch (error) {
      throw new MissionDomainRepositoryError(
        'INVALID_CONTEXT',
        error instanceof Error ? error.message : 'StoreContextEnvelope is invalid.',
      );
    }
    const store = this.db.prepare(`
      SELECT store_id, browser_profile_id, marketplace, currency,
             business_timezone, status
      FROM stores WHERE store_id = ?
    `).get(context.storeId) as StoreAuthorityRow | undefined;
    if (!store
      || store.browser_profile_id !== context.browserProfileId
      || store.marketplace !== context.marketplace
      || store.currency !== context.currency
      || store.business_timezone !== context.businessTimezone) {
      throw new MissionDomainRepositoryError(
        'INVALID_CONTEXT',
        'StoreContextEnvelope does not match SQLite store authority.',
      );
    }
    if (store.status !== 'active') {
      throw new MissionDomainRepositoryError(
        'STORE_NOT_ACTIVE',
        `Store ${context.storeId} is ${store.status}; Mission domain access is blocked.`,
      );
    }
    const setting = this.db.prepare(`
      SELECT value FROM app_settings WHERE key = ?
    `).get(`store_session_generation:${context.storeId}`) as { value: string | null } | undefined;
    const durable = setting?.value === undefined || setting.value === null
      ? Number((this.db.prepare(`
          SELECT COALESCE(MAX(session_generation), 0) AS generation
          FROM store_session_metadata WHERE store_id = ?
        `).get(context.storeId) as { generation: number }).generation)
      : Number(setting.value);
    if (!Number.isSafeInteger(durable) || durable < 0 || context.sessionGeneration !== durable) {
      throw new MissionDomainRepositoryError(
        'STALE_CONTEXT',
        `Store session generation is stale; expected ${durable}, received ${context.sessionGeneration}.`,
      );
    }
    return context;
  }

export function requirePolicy(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, idInput: string): PolicyRecord{
    const id = idOf(idInput, 'policyId');
    const row = this.db.prepare(`SELECT * FROM policies WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as PolicyRow | undefined;
    if (!row) throw notFound(`Policy ${id} was not found in store ${context.storeId}.`);
    return mapPolicy(row);
  }

export function requirePolicyVersion(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, idInput: string): PolicyVersionRecord{
    const id = idOf(idInput, 'policyVersionId');
    const row = this.db.prepare(`SELECT * FROM policy_versions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as PolicyVersionRow | undefined;
    if (!row) throw notFound(`Policy version ${id} was not found in store ${context.storeId}.`);
    return mapPolicyVersion(row);
  }

export function requireMission(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, idInput: string): MissionRecord{
    const id = idOf(idInput, 'missionId');
    const row = this.db.prepare(`SELECT * FROM missions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as MissionRow | undefined;
    if (!row) throw notFound(`Mission ${id} was not found in store ${context.storeId}.`);
    return mapMission(row);
  }

export function requireMissionLink(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, idInput: string): MissionLinkRecord{
    const id = idOf(idInput, 'missionLinkId');
    const row = this.db.prepare(`SELECT * FROM mission_links WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as Record<string, unknown> | undefined;
    if (!row) throw notFound(`Mission link ${id} was not found.`);
    return mapMissionLink(row);
  }

export function requireMissionCheckpoint(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    idInput: string,
  ): MissionCheckpointRecord{
    const id = idOf(idInput, 'missionCheckpointId');
    const row = this.db.prepare(`
      SELECT * FROM mission_checkpoints WHERE store_id = ? AND id = ?
    `).get(context.storeId, id) as Record<string, unknown> | undefined;
    if (!row) throw notFound(`Mission checkpoint ${id} was not found.`);
    return mapMissionCheckpoint(row);
  }

export function requireMissionGrant(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, idInput: string): MissionGrantRecord{
    const id = idOf(idInput, 'grantId');
    const row = this.db.prepare(`SELECT * FROM mission_grants WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as GrantRow | undefined;
    if (!row) throw notFound(`MissionGrant ${id} was not found in store ${context.storeId}.`);
    return this.projectGrant(context, row);
  }

export function requireDecision(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, idInput: string): DecisionRecord{
    const id = idOf(idInput, 'decisionId');
    const row = this.db.prepare(`SELECT * FROM decisions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as DecisionRow | undefined;
    if (!row) throw notFound(`Decision ${id} was not found in store ${context.storeId}.`);
    return mapDecision(row);
  }

export function requireExperiment(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, idInput: string): ExperimentRecord{
    const id = idOf(idInput, 'experimentId');
    const row = this.db.prepare(`SELECT * FROM experiments WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as ExperimentRow | undefined;
    if (!row) throw notFound(`Experiment ${id} was not found in store ${context.storeId}.`);
    return mapExperiment(row);
  }

export function requireExperimentObservation(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    experimentId: string,
    idInput: string,
  ): ExperimentObservationRecord{
    const id = idOf(idInput, 'experimentRecordId');
    const row = this.db.prepare(`
      SELECT * FROM experiment_records WHERE store_id = ? AND experiment_id = ? AND id = ?
    `).get(context.storeId, experimentId, id) as Record<string, unknown> | undefined;
    if (!row) throw notFound(`Experiment observation ${id} was not found.`);
    return mapExperimentObservation(row);
  }

export function requireCausalEvent(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, idInput: string): CausalEventRecord{
    const id = idOf(idInput, 'causalEventId');
    const row = this.db.prepare(`SELECT * FROM causal_events WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as CausalRow | undefined;
    if (!row) throw notFound(`Causal event ${id} was not found in store ${context.storeId}.`);
    return mapCausalEvent(row);
  }

export function assertRevision(this: MissionDomainRepositoryContext, current: number, expectedInput: number, label: string): void{
    const expected = revisionOf(expectedInput, 'expectedRevision');
    if (current !== expected) {
      throw new MissionDomainRepositoryError(
        'REVISION_CONFLICT',
        `${label} revision changed from ${expected} to ${current}; reload before retrying.`,
      );
    }
  }

export function assertCas(this: MissionDomainRepositoryContext, changes: number, label: string): void{
    if (changes !== 1) {
      throw new MissionDomainRepositoryError(
        'REVISION_CONFLICT',
        `${label} changed concurrently; reload before retrying.`,
      );
    }
  }

export function timestamp(this: MissionDomainRepositoryContext): string{
    return this.now().toISOString();
  }

export function rethrowConstraint(this: MissionDomainRepositoryContext, error: unknown, message: string): never{
    if (isConstraint(error)) {
      throw new MissionDomainRepositoryError('DUPLICATE_IDENTITY', message);
    }
    throw error;
  }
