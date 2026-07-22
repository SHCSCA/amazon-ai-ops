import { createHash } from 'crypto';
import type Database from 'better-sqlite3';
import {
  AD_EXECUTION_ACTION_TYPE,
  MAX_AD_EXECUTION_ACTIONS_PER_BATCH,
  assertOpaqueExecutionArtifactRef,
  isTerminalAdExecutionStatus,
  normalizeStoreContextEnvelope,
  type AdExecutionBatchProjection,
  type AdExecutionBatchRecord,
  type AdExecutionDomainReconciliationRecord,
  type AdExecutionEvidenceInput,
  type AdExecutionEvidenceRecord,
  type AdExecutionEvidenceSlot,
  type AdExecutionEventRecord,
  type AdExecutionEventType,
  type AdExecutionJobProjection,
  type AdExecutionJobRecord,
  type AdExecutionJobTransitionRequest,
  type AdExecutionRecoveryItem,
  type AdExecutionStartupRecoveryResult,
  type AdExecutionStatus,
  type AdExecutionTerminalStatus,
  type AdExecutionTransitionResult,
  type AdKeywordAliasResolutionRecord,
  type AdKeywordIdentityVersionRecord,
  type CreateAdExecutionBatchResult,
  type CompleteAdExecutionDomainReconciliationResult,
  type MarkAdExecutionTerminalRequest,
  type RecordAdExecutionEvidenceRequest,
  type RecordAdExecutionPreflightRequest,
  type RecordAdExecutionSubmitIntentRequest,
  type RecordAdKeywordAliasResolutionInput,
  type RegisterAdKeywordIdentityInput,
  type ResolveCanonicalKeywordInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

export type ExecutionAuthorityErrorCode =
  | 'INVALID_CONTEXT'
  | 'STORE_NOT_ACTIVE'
  | 'STALE_CONTEXT'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'REFERENCE_CONFLICT'
  | 'STATE_CONFLICT'
  | 'REVISION_CONFLICT'
  | 'TERMINAL_STATE';

export class ExecutionAuthorityRepositoryError extends Error {
  constructor(
    readonly code: ExecutionAuthorityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExecutionAuthorityRepositoryError';
  }
}

export interface ExecutionAuthorityRepositoryOptions {
  now?: () => Date;
}

interface IdentityRow {
  identity_version_id: string;
  store_id: string;
  marketplace: 'US';
  currency: 'USD';
  canonical_keyword_id: string;
  ad_entity_id: string;
  entity_revision: number;
  ads_account_id: string;
  campaign_id: string;
  ad_group_id: string;
  keyword_id: string;
  object_revision: number;
  observed_bid_cents: number;
  page_identity_hash: string;
  source_authority_id: string;
  source_authority_proof_sha256: string;
  resolution_proof_sha256: string;
  resolved_session_generation: number;
  resolved_at: string;
  resolved_by: string;
  created_at: string;
}

interface AliasRow {
  id: string;
  store_id: string;
  alias_type: AdKeywordAliasResolutionRecord['aliasType'];
  alias_hash: string;
  canonical_keyword_id: string;
  object_revision: number;
  resolution_revision: number;
  status: AdKeywordAliasResolutionRecord['status'];
  reason: string | null;
  resolved_session_generation: number;
  resolved_at: string;
  resolved_by: string;
}

interface BatchRow {
  id: string;
  store_id: string;
  marketplace: 'US';
  currency: 'USD';
  mission_id: string;
  mission_revision: number;
  grant_id: string;
  action_revision: number;
  status: AdExecutionStatus;
  revision: number;
  created_session_generation: number;
  created_at: string;
  updated_at: string;
  terminal_at: string | null;
}

interface JobRow {
  id: string;
  store_id: string;
  batch_id: string;
  ordinal: number;
  mission_id: string;
  grant_id: string;
  proposal_id: string;
  decision_id: string;
  decision_revision: number;
  action_revision: number;
  action_type: typeof AD_EXECUTION_ACTION_TYPE;
  canonical_keyword_id: string;
  ad_entity_id: string;
  entity_revision: number;
  ads_account_id: string;
  campaign_id: string;
  ad_group_id: string;
  keyword_id: string;
  object_revision: number;
  page_identity_hash: string;
  expected_bid_cents: number;
  target_bid_cents: number;
  change_pct: number;
  idempotency_key: string;
  status: AdExecutionStatus;
  revision: number;
  created_session_generation: number;
  created_at: string;
  updated_at: string;
  submit_intent_id: string | null;
  command_fingerprint: string | null;
  intent_written_at: string | null;
  submitted_at: string | null;
  terminal_at: string | null;
}

interface EventRow {
  id: string;
  store_id: string;
  batch_id: string;
  job_id: string;
  sequence: number;
  event_type: AdExecutionEventType;
  from_status: AdExecutionStatus;
  to_status: AdExecutionStatus;
  actor_id: string;
  reason_code: string | null;
  detail: string | null;
  session_generation: number;
  created_at: string;
}

interface EvidenceRow {
  id: string;
  store_id: string;
  batch_id: string;
  job_id: string;
  slot: AdExecutionEvidenceSlot;
  artifact_ref: string;
  content_sha256: string;
  page_identity_hash: string;
  canonical_keyword_id: string;
  object_revision: number;
  observed_bid_cents: number;
  captured_session_generation: number;
  captured_at: string;
  created_at: string;
}

interface DomainReconciliationRow {
  id: string;
  store_id: string;
  batch_id: string;
  batch_status: AdExecutionTerminalStatus;
  evidence_ref_count: number;
  completed_session_generation: number;
  completed_at: string;
}

interface CausalEvidenceRefRow {
  id: string;
  store_id: string;
  event_id: string;
  evidence_type: string;
  evidence_ref: string;
  sha256: string | null;
  created_at: string;
}

interface GrantRow {
  id: string;
  marketplace: string;
  currency: string;
  mission_id: string;
  mission_revision: number;
  decision_ids_json: string;
  action_revision: number;
  allowed_action_types_json: string;
  allowed_ad_entity_ids_json: string;
  max_change_pct: number;
  total_impact_budget: number;
  expires_at: string;
  policy_version_id: string;
  policy_revision: number;
  issuer_type: 'human' | 'policy';
  created_session_generation: number;
}

interface ProposalDecisionRow {
  proposal_id: string;
  marketplace: string;
  currency: string;
  mission_id: string;
  mission_revision: number;
  policy_version_id: string;
  policy_revision: number;
  action_revision: number;
  action_type: string;
  entity_type: string;
  ad_entity_id: string | null;
  ad_entity_revision: number | null;
  current_bid_cents: number;
  proposed_bid_cents: number;
  change_pct: number;
  authorization_json: string;
  valid_until: string;
  created_session_generation: number;
  decision_id: string;
  decision_revision: number;
  decision_status: string;
  decision_action_type: string;
  decision_ad_entity_id: string | null;
  decision_action_revision: number;
  decision_policy_version_id: string;
  decision_policy_revision: number;
  decision_valid_until: string | null;
}

/**
 * Main-only Stage 6 authority ledger. Every mutation uses BEGIN IMMEDIATE and
 * all public projections contain opaque refs/hashes instead of local paths or browser content.
 */
export class ExecutionAuthorityRepository {
  private readonly now: () => Date;

  constructor(
    private readonly db: Database.Database,
    options: ExecutionAuthorityRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  registerCanonicalKeywordIdentity(
    contextInput: StoreContextEnvelope,
    input: RegisterAdKeywordIdentityInput,
  ): AdKeywordIdentityVersionRecord {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
      this.assertContext(context, input.adsAccountId);
      const adEntityId = idOf(input.adEntityId, 'adEntityId');
      const entityRevision = positiveInt(input.entityRevision, 'entityRevision');
      const latestAuthority = this.db.prepare(`
        SELECT authority_id AS authorityId, entity_revision AS entityRevision,
               entity_type AS entityType, proof_sha256 AS proofSha256
        FROM verified_ad_entity_authority
        WHERE store_id = ? AND ad_entity_id = ?
        ORDER BY entity_revision DESC, created_at DESC, authority_id DESC LIMIT 1
      `).get(context.storeId, adEntityId) as {
        authorityId: string;
        entityRevision: number;
        entityType: string;
        proofSha256: string;
      } | undefined;
      if (!latestAuthority) throw notFound(`Stage 5 Ads entity ${adEntityId} was not found.`);
      if (latestAuthority.entityType !== 'keyword') {
        throw referenceConflict('Execution V1 accepts only a Stage 5 keyword authority.');
      }
      if (latestAuthority.entityRevision !== entityRevision) {
        throw revisionConflict(
          `Stage 5 Ads entity revision is stale; expected ${latestAuthority.entityRevision}, received ${entityRevision}.`,
        );
      }
      const adsAccountId = idOf(input.adsAccountId, 'adsAccountId');
      const campaignId = idOf(input.campaignId, 'campaignId');
      const adGroupId = idOf(input.adGroupId, 'adGroupId');
      const keywordId = idOf(input.keywordId, 'keywordId');
      const observedBidCents = positiveInt(input.observedBidCents, 'observedBidCents');
      const pageIdentityHash = sha256Of(input.pageIdentityHash, 'pageIdentityHash');
      const sourceAuthorityProofSha256 = sha256Of(
        latestAuthority.proofSha256,
        'sourceAuthorityProofSha256',
      );
      const resolutionProofSha256 = sha256Of(
        input.resolutionProofSha256,
        'resolutionProofSha256',
      );
      const resolvedAt = timestampOf(input.resolvedAt, 'resolvedAt');
      const resolvedBy = idOf(input.resolvedBy, 'resolvedBy');
      const canonicalKeywordId = `ad-keyword:${hashObject([
        context.storeId, adsAccountId, campaignId, adGroupId, keywordId,
      ]).slice(0, 40)}`;

      const existing = this.db.prepare(`
        SELECT * FROM ad_keyword_identity_versions
        WHERE store_id = ? AND ad_entity_id = ? AND entity_revision = ?
        ORDER BY object_revision DESC, created_at DESC, identity_version_id DESC
        LIMIT 1
      `).get(context.storeId, adEntityId, entityRevision) as IdentityRow | undefined;
      if (existing) {
        const mapped = mapIdentity(existing);
        const stableMapping = mapped.canonicalKeywordId === canonicalKeywordId
          && mapped.adsAccountId === adsAccountId
          && mapped.campaignId === campaignId
          && mapped.adGroupId === adGroupId
          && mapped.keywordId === keywordId
          && mapped.pageIdentityHash === pageIdentityHash
          && mapped.sourceAuthorityId === latestAuthority.authorityId
          && mapped.sourceAuthorityProofSha256 === sourceAuthorityProofSha256;
        if (!stableMapping) {
          throw referenceConflict(
            'Stage 5 entity revision drifted across canonical ids, page identity, or source authority.',
          );
        }
        const sameResolution = mapped.resolvedSessionGeneration === context.sessionGeneration
          && mapped.observedBidCents === observedBidCents
          && mapped.resolutionProofSha256 === resolutionProofSha256;
        if (sameResolution) {
          return mapped;
        }
      }

      const objectRevision = Number((this.db.prepare(`
        SELECT COALESCE(MAX(object_revision), 0) + 1 AS revision
        FROM ad_keyword_identity_versions WHERE store_id = ? AND canonical_keyword_id = ?
      `).get(context.storeId, canonicalKeywordId) as { revision: number }).revision);
      const createdAt = this.timestamp();
      const identityVersionId = `kwid-${hashObject([
        context.storeId, adEntityId, entityRevision, canonicalKeywordId, objectRevision,
      ]).slice(0, 40)}`;
      this.db.prepare(`
        INSERT INTO ad_keyword_identity_versions (
          identity_version_id, store_id, marketplace, currency, canonical_keyword_id,
          ad_entity_id, entity_revision, ads_account_id, campaign_id, ad_group_id,
          keyword_id, object_revision, observed_bid_cents, page_identity_hash,
          source_authority_id, source_authority_proof_sha256, resolution_proof_sha256,
          resolved_session_generation, resolved_at, resolved_by, created_at
        ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        identityVersionId, context.storeId, canonicalKeywordId, adEntityId, entityRevision,
        adsAccountId, campaignId, adGroupId, keywordId, objectRevision, observedBidCents,
        pageIdentityHash, latestAuthority.authorityId, sourceAuthorityProofSha256,
        resolutionProofSha256, context.sessionGeneration, resolvedAt, resolvedBy, createdAt,
      );
      return this.requireIdentityVersion(context.storeId, canonicalKeywordId, objectRevision);
    });
  }

  resolveCanonicalKeyword(
    contextInput: StoreContextEnvelope,
    input: ResolveCanonicalKeywordInput,
  ): AdKeywordIdentityVersionRecord {
    const context = normalizeContext(contextInput);
    this.assertContext(context, input.adsAccountId);
    const row = this.db.prepare(`
      SELECT * FROM ad_keyword_identity_versions
      WHERE store_id = ? AND ads_account_id = ? AND campaign_id = ?
        AND ad_group_id = ? AND keyword_id = ?
      ORDER BY object_revision DESC, created_at DESC, identity_version_id DESC LIMIT 1
    `).get(
      context.storeId,
      idOf(input.adsAccountId, 'adsAccountId'),
      idOf(input.campaignId, 'campaignId'),
      idOf(input.adGroupId, 'adGroupId'),
      idOf(input.keywordId, 'keywordId'),
    ) as IdentityRow | undefined;
    if (!row) throw notFound('Canonical keyword identity was not found.');
    if (input.expectedObjectRevision !== undefined
      && positiveInt(input.expectedObjectRevision, 'expectedObjectRevision') !== row.object_revision) {
      throw revisionConflict(
        `Canonical keyword revision is stale; expected ${row.object_revision}, received ${input.expectedObjectRevision}.`,
      );
    }
    return mapIdentity(row);
  }

  listCanonicalKeywordIdentities(
    contextInput: StoreContextEnvelope,
  ): readonly AdKeywordIdentityVersionRecord[] {
    const context = normalizeContext(contextInput);
    this.assertContext(context);
    return (this.db.prepare(`
      SELECT identity.* FROM ad_keyword_identity_versions identity
      WHERE identity.store_id = ? AND NOT EXISTS (
        SELECT 1 FROM ad_keyword_identity_versions newer
        WHERE newer.store_id = identity.store_id
          AND newer.canonical_keyword_id = identity.canonical_keyword_id
          AND newer.object_revision > identity.object_revision
      ) ORDER BY identity.canonical_keyword_id
    `).all(context.storeId) as IdentityRow[]).map(mapIdentity);
  }

  recordCanonicalKeywordAliasResolution(
    contextInput: StoreContextEnvelope,
    input: RecordAdKeywordAliasResolutionInput,
  ): AdKeywordAliasResolutionRecord {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
      this.assertContext(context);
      const canonicalKeywordId = idOf(input.canonicalKeywordId, 'canonicalKeywordId');
      const objectRevision = positiveInt(input.objectRevision, 'objectRevision');
      this.requireIdentityVersion(context.storeId, canonicalKeywordId, objectRevision);
      const aliasHash = sha256Of(input.aliasHash, 'aliasHash');
      const prior = this.db.prepare(`
        SELECT COALESCE(MAX(resolution_revision), 0) AS revision
        FROM ad_keyword_alias_resolutions WHERE store_id = ? AND alias_type = ? AND alias_hash = ?
      `).get(context.storeId, input.aliasType, aliasHash) as { revision: number };
      const resolutionRevision = Number(prior.revision) + 1;
      const id = idOf(input.id, 'id');
      this.db.prepare(`
        INSERT INTO ad_keyword_alias_resolutions (
          id, store_id, alias_type, alias_hash, canonical_keyword_id, object_revision,
          resolution_revision, status, reason, resolved_session_generation,
          resolved_at, resolved_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, context.storeId, input.aliasType, aliasHash, canonicalKeywordId, objectRevision,
        resolutionRevision, input.status,
        input.reason === undefined ? null : safeProjectionText(input.reason, 'reason'),
        context.sessionGeneration,
        timestampOf(input.resolvedAt, 'resolvedAt'), idOf(input.resolvedBy, 'resolvedBy'),
      );
      return mapAlias(this.db.prepare(`
        SELECT * FROM ad_keyword_alias_resolutions WHERE store_id = ? AND id = ?
      `).get(context.storeId, id) as AliasRow);
    });
  }

  createExactExecutionBatch(
    contextInput: StoreContextEnvelope,
    grantIdInput: string,
  ): CreateAdExecutionBatchResult {
    const context = normalizeContext(contextInput);
    const grantId = idOf(grantIdInput, 'grantId');
    return this.immediate(() => {
      this.assertContext(context);
      const existing = this.db.prepare(`
        SELECT id FROM ad_execution_batches WHERE store_id = ? AND grant_id = ?
      `).get(context.storeId, grantId) as { id: string } | undefined;
      if (existing) return { created: false, projection: this.requireProjection(context.storeId, existing.id) };

      const grant = this.requireGrant(context, grantId);
      const decisionIds = uniqueStringArray(parseJson(grant.decision_ids_json, 'grant decision ids'));
      const actionTypes = uniqueStringArray(parseJson(grant.allowed_action_types_json, 'grant action types'));
      const entityIds = uniqueStringArray(parseJson(grant.allowed_ad_entity_ids_json, 'grant entity ids'));
      if (decisionIds.length === 0 || entityIds.length === 0) throw invalid('Execution grant scope is empty.');
      if (decisionIds.length > MAX_AD_EXECUTION_ACTIONS_PER_BATCH
        || entityIds.length > MAX_AD_EXECUTION_ACTIONS_PER_BATCH) {
        throw stateConflict(
          `Execution V1 allows at most ${MAX_AD_EXECUTION_ACTIONS_PER_BATCH} actions per batch.`,
        );
      }
      if (actionTypes.length !== 1 || actionTypes[0] !== AD_EXECUTION_ACTION_TYPE) {
        throw stateConflict('Execution V1 grant must allow only set_keyword_bid.');
      }

      const rows = decisionIds.map((decisionId) => this.requireProposalDecision(context, decisionId));
      const linkedEntityIds = rows.map((row) => idOf(row.ad_entity_id, 'proposal adEntityId'));
      if (!sameStringSet(entityIds, linkedEntityIds)) {
        throw referenceConflict('Grant entity scope must exactly match its linked immutable proposals.');
      }
      const cap = Math.min(10, finite(grant.max_change_pct, 'grant maxChangePct'));
      let cumulativeImpactUsd = 0;
      const planned = rows.map((row, index) => {
        this.validateProposalDecision(context, grant, row);
        const identity = this.requireLatestIdentityForEntity(
          context,
          idOf(row.ad_entity_id, 'proposal adEntityId'),
          positiveInt(row.ad_entity_revision, 'proposal adEntityRevision'),
        );
        this.assertContext(context, identity.adsAccountId);
        const expectedBidCents = positiveInt(row.current_bid_cents, 'currentBidCents');
        const targetBidCents = positiveInt(row.proposed_bid_cents, 'proposedBidCents');
        if (targetBidCents >= expectedBidCents) throw stateConflict('Execution V1 is downbid-only.');
        const changePct = ((targetBidCents - expectedBidCents) / expectedBidCents) * 100;
        if (changePct >= 0 || Math.abs(changePct) > cap + 1e-9 || Math.abs(changePct - row.change_pct) > 1e-6) {
          throw stateConflict(`Proposal change must be a downbid within ${cap}%.`);
        }
        cumulativeImpactUsd += Math.abs(expectedBidCents - targetBidCents) / 100;
        const idempotencyKey = hashObject([
          grant.id, row.decision_id, row.decision_revision, row.proposal_id,
          grant.action_revision, identity.canonicalKeywordId, identity.objectRevision,
          expectedBidCents, targetBidCents,
        ]);
        return { row, identity, expectedBidCents, targetBidCents, changePct, idempotencyKey, ordinal: index + 1 };
      });
      if (cumulativeImpactUsd > finite(grant.total_impact_budget, 'grant totalImpactBudget') + 1e-9) {
        throw stateConflict('Execution batch exceeds the grant total impact budget.');
      }

      const batchId = `exec-batch-${hashObject([
        context.storeId, grant.id, grant.mission_id, grant.mission_revision, grant.action_revision,
      ]).slice(0, 40)}`;
      const createdAt = this.timestamp();
      this.db.prepare(`
        INSERT INTO ad_execution_batches (
          id, store_id, marketplace, currency, mission_id, mission_revision, grant_id,
          action_revision, status, revision, created_session_generation, created_at, updated_at
        ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, 'queued', 1, ?, ?, ?)
      `).run(
        batchId, context.storeId, grant.mission_id, grant.mission_revision, grant.id,
        grant.action_revision, context.sessionGeneration, createdAt, createdAt,
      );
      for (const item of planned) {
        const jobId = `exec-job-${hashObject([batchId, item.row.proposal_id]).slice(0, 40)}`;
        this.db.prepare(`
          INSERT INTO ad_execution_jobs (
            id, store_id, batch_id, ordinal, mission_id, grant_id, proposal_id,
            decision_id, decision_revision, action_revision, action_type,
            canonical_keyword_id, ad_entity_id, entity_revision, ads_account_id,
            campaign_id, ad_group_id, keyword_id, object_revision, page_identity_hash,
            expected_bid_cents, target_bid_cents, change_pct, idempotency_key,
            status, revision, created_session_generation, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'set_keyword_bid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            'queued', 1, ?, ?, ?)
        `).run(
          jobId, context.storeId, batchId, item.ordinal, grant.mission_id, grant.id,
          item.row.proposal_id, item.row.decision_id, item.row.decision_revision, grant.action_revision,
          item.identity.canonicalKeywordId, item.identity.adEntityId, item.identity.entityRevision,
          item.identity.adsAccountId, item.identity.campaignId, item.identity.adGroupId,
          item.identity.keywordId, item.identity.objectRevision, item.identity.pageIdentityHash,
          item.expectedBidCents, item.targetBidCents, item.changePct, item.idempotencyKey,
          context.sessionGeneration, createdAt, createdAt,
        );
        this.insertEvent({
          storeId: context.storeId,
          batchId,
          jobId,
          sequence: 1,
          eventType: 'queued',
          fromStatus: 'queued',
          toStatus: 'queued',
          actorId: 'execution-authority',
          sessionGeneration: context.sessionGeneration,
          createdAt,
        });
      }
      return { created: true, projection: this.requireProjection(context.storeId, batchId) };
    });
  }

  getExecutionBatch(
    contextInput: StoreContextEnvelope,
    batchIdInput: string,
  ): AdExecutionBatchProjection | undefined {
    const context = normalizeContext(contextInput);
    this.assertContext(context);
    const batchId = idOf(batchIdInput, 'batchId');
    const row = this.db.prepare(`
      SELECT id FROM ad_execution_batches WHERE store_id = ? AND id = ?
    `).get(context.storeId, batchId);
    return row ? this.requireProjection(context.storeId, batchId) : undefined;
  }

  listExecutionBatches(contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[] {
    const context = normalizeContext(contextInput);
    this.assertContext(context);
    return (this.db.prepare(`
      SELECT id FROM ad_execution_batches WHERE store_id = ? ORDER BY created_at DESC, id DESC
    `).all(context.storeId) as Array<{ id: string }>).map((row) => this.requireProjection(context.storeId, row.id));
  }

  startJob(
    contextInput: StoreContextEnvelope,
    input: Omit<AdExecutionJobTransitionRequest, 'context'>,
  ): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
      this.assertContext(context);
      const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['queued']);
      this.requireGrant(context, job.grant_id);
      return this.applyTransition(context, job, 'preflight', 'started', 'executor');
    });
  }

  recordPreflight(
    contextInput: StoreContextEnvelope,
    input: Omit<RecordAdExecutionPreflightRequest, 'context'>,
  ): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
      this.assertContext(context);
      const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['preflight']);
      this.requireGrant(context, job.grant_id);
      this.assertExactReadback(job, input);
      if (positiveInt(input.observedBidCents, 'observedBidCents') !== job.expected_bid_cents) {
        throw stateConflict('Preflight observed bid does not match the immutable expected-before value.');
      }
      return this.applyTransition(context, job, 'preflight', 'preflight_verified', 'executor');
    });
  }

  recordSubmitIntent(
    contextInput: StoreContextEnvelope,
    input: Omit<RecordAdExecutionSubmitIntentRequest, 'context'>,
  ): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
      this.assertContext(context);
      const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['preflight']);
      this.requireGrant(context, job.grant_id);
      this.assertEvidenceMatchesJob(job, input.before);
      const submitIntentId = idOf(input.submitIntentId, 'submitIntentId');
      const commandFingerprint = sha256Of(input.commandFingerprint, 'commandFingerprint');
      if (input.before.observedBidCents !== job.expected_bid_cents) {
        throw stateConflict('Before evidence must prove the immutable expected-before bid before click.');
      }
      this.insertEvidence(context, job, 'before', input.before);
      return this.applyTransition(
        context, job, 'intent_written', 'submit_intent_recorded', 'executor', undefined, undefined,
        {
          intentWrittenAt: this.timestamp(),
          submitIntentId,
          commandFingerprint,
        },
      );
    });
  }

  recordSubmitted(
    contextInput: StoreContextEnvelope,
    input: Omit<AdExecutionJobTransitionRequest, 'context'>,
  ): AdExecutionTransitionResult {
    return this.transition(
      contextInput, input, ['intent_written'], 'submitted', 'submitted', 'executor',
      undefined, undefined, { submittedAt: this.timestamp() },
    );
  }

  recordAfterEvidence(
    contextInput: StoreContextEnvelope,
    input: Omit<RecordAdExecutionEvidenceRequest, 'context'>,
  ): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
      this.assertContext(context);
      const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['submitted']);
      this.assertEvidenceMatchesJob(job, input.evidence);
      this.insertEvidence(context, job, 'after', input.evidence);
      return this.applyTransition(context, job, 'verifying', 'after_recorded', 'executor');
    });
  }

  recordReloadVerified(
    contextInput: StoreContextEnvelope,
    input: Omit<RecordAdExecutionEvidenceRequest, 'context'>,
  ): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
      this.assertContext(context);
      const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['verifying']);
      this.assertEvidenceMatchesJob(job, input.evidence);
      const after = this.db.prepare(`
        SELECT * FROM ad_execution_evidence WHERE store_id = ? AND job_id = ? AND slot = 'after'
      `).get(context.storeId, job.id) as EvidenceRow | undefined;
      if (!after
        || after.observed_bid_cents !== job.target_bid_cents
        || input.evidence.observedBidCents !== job.target_bid_cents
        || after.page_identity_hash !== input.evidence.pageIdentityHash
        || after.canonical_keyword_id !== input.evidence.canonicalKeywordId
        || after.object_revision !== input.evidence.objectRevision) {
        throw stateConflict('After and reload evidence must independently prove the exact target on the same page identity.');
      }
      this.insertEvidence(context, job, 'reload', input.evidence);
      return this.applyTransition(
        context, job, 'succeeded', 'reload_verified', 'executor', undefined, undefined,
        { terminalAt: this.timestamp() },
      );
    });
  }

  markBlocked(
    contextInput: StoreContextEnvelope,
    input: Omit<MarkAdExecutionTerminalRequest, 'context'>,
  ): AdExecutionTransitionResult {
    return this.transition(
      contextInput, input, ['queued', 'preflight'], 'blocked', 'blocked', 'executor',
      input.reasonCode, input.detail, { terminalAt: this.timestamp() }, true,
    );
  }

  /**
   * Narrow post-intent escape hatch. Main may call this only when the adapter
   * proves clickOnce was never invoked (submitAttempted === false).
   */
  markNotSubmittedAfterIntent(
    contextInput: StoreContextEnvelope,
    input: Omit<MarkAdExecutionTerminalRequest, 'context'>,
  ): AdExecutionTransitionResult {
    return this.transition(
      contextInput, input, ['intent_written'], 'blocked', 'blocked', 'executor',
      input.reasonCode, input.detail, { terminalAt: this.timestamp() },
    );
  }

  markUnknown(
    contextInput: StoreContextEnvelope,
    input: Omit<MarkAdExecutionTerminalRequest, 'context'>,
  ): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
      this.assertContext(context);
      const job = this.requireMutableJob(
        context,
        input.jobId,
        input.expectedRevision,
        ['intent_written', 'submitted', 'verifying'],
        true,
      );
      const reasonCode = idOf(input.reasonCode, 'reasonCode');
      const detail = input.detail === undefined
        ? undefined
        : safeProjectionText(input.detail, 'detail');
      const updatedAt = this.timestamp();
      const changed = this.db.prepare(`
        UPDATE ad_execution_jobs SET status = 'unknown', revision = revision + 1,
          updated_at = ?, terminal_at = COALESCE(terminal_at, ?)
        WHERE store_id = ? AND id = ? AND revision = ?
          AND status IN ('intent_written', 'submitted', 'verifying')
      `).run(updatedAt, updatedAt, context.storeId, job.id, job.revision);
      if (changed.changes !== 1) throw revisionConflict(`Execution job ${job.id} lost its UNKNOWN CAS transition.`);
      this.insertEvent({
        storeId: context.storeId,
        batchId: job.batch_id,
        jobId: job.id,
        sequence: this.nextEventSequence(context.storeId, job.id),
        eventType: 'unknown',
        fromStatus: job.status,
        toStatus: 'unknown',
        actorId: 'executor',
        reasonCode,
        detail,
        sessionGeneration: context.sessionGeneration,
        createdAt: updatedAt,
      });

      // UNKNOWN is a Mission-wide stop. Cancel every sibling that provably has
      // not crossed submit intent before the batch itself becomes terminal.
      const siblings = this.db.prepare(`
        SELECT * FROM ad_execution_jobs
        WHERE store_id = ? AND batch_id = ? AND id <> ?
          AND status IN ('queued', 'preflight')
        ORDER BY ordinal
      `).all(context.storeId, job.batch_id, job.id) as JobRow[];
      for (const sibling of siblings) {
        const cancelled = this.db.prepare(`
          UPDATE ad_execution_jobs SET status = 'cancelled', revision = revision + 1,
            updated_at = ?, terminal_at = COALESCE(terminal_at, ?)
          WHERE store_id = ? AND id = ? AND revision = ?
            AND status IN ('queued', 'preflight')
        `).run(updatedAt, updatedAt, context.storeId, sibling.id, sibling.revision);
        if (cancelled.changes !== 1) {
          throw revisionConflict(`Execution sibling ${sibling.id} lost its UNKNOWN-stop CAS transition.`);
        }
        this.insertEvent({
          storeId: context.storeId,
          batchId: sibling.batch_id,
          jobId: sibling.id,
          sequence: this.nextEventSequence(context.storeId, sibling.id),
          eventType: 'cancelled',
          fromStatus: sibling.status,
          toStatus: 'cancelled',
          actorId: 'executor',
          reasonCode: 'batch_stopped_after_unknown',
          detail: 'Mission batch stopped before this action entered submit intent.',
          sessionGeneration: sibling.created_session_generation,
          createdAt: updatedAt,
        });
      }
      const batch = this.refreshBatchStatus(context.storeId, job.batch_id, updatedAt);
      if (isTerminalAdExecutionStatus(batch.status)) {
        this.ensureExecutionGrantTerminal(
          context.storeId,
          job.grant_id,
          job.batch_id,
          batch.status,
          updatedAt,
        );
      }
      const projection = this.requireProjection(context.storeId, job.batch_id);
      const current = projection.jobs.find((candidate) => candidate.id === job.id);
      if (!current) throw notFound(`Execution job ${job.id} disappeared after UNKNOWN transition.`);
      return { job: current, batch, missionId: job.mission_id, grantId: job.grant_id };
    });
  }

  cancelJob(
    contextInput: StoreContextEnvelope,
    input: Omit<MarkAdExecutionTerminalRequest, 'context'>,
  ): AdExecutionTransitionResult {
    return this.transition(
      contextInput, input, ['queued', 'preflight'], 'cancelled', 'cancelled', 'executor',
      input.reasonCode, input.detail, { terminalAt: this.timestamp() }, true,
    );
  }

  recoverInterruptedExecutions(): AdExecutionStartupRecoveryResult {
    return this.immediate(() => {
      const recoveredAt = this.timestamp();
      const interrupted = this.db.prepare(`
        SELECT * FROM ad_execution_jobs
        WHERE status IN ('intent_written', 'submitted', 'verifying')
        ORDER BY store_id, batch_id, ordinal
      `).all() as JobRow[];
      const markedUnknown: AdExecutionRecoveryItem[] = [];
      const affectedBatchKeys = new Set<string>();
      for (const job of interrupted) {
        const previousStatus = job.status as AdExecutionRecoveryItem['previousStatus'];
        const changed = this.db.prepare(`
          UPDATE ad_execution_jobs SET status = 'unknown', revision = revision + 1,
            updated_at = ?, terminal_at = ?
          WHERE store_id = ? AND id = ? AND revision = ?
            AND status IN ('intent_written', 'submitted', 'verifying')
        `).run(recoveredAt, recoveredAt, job.store_id, job.id, job.revision);
        if (changed.changes !== 1) throw revisionConflict('Interrupted execution recovery lost its CAS race.');
        const sequence = this.nextEventSequence(job.store_id, job.id);
        this.insertEvent({
          storeId: job.store_id,
          batchId: job.batch_id,
          jobId: job.id,
          sequence,
          eventType: 'unknown',
          fromStatus: previousStatus,
          toStatus: 'unknown',
          actorId: 'startup-recovery',
          reasonCode: 'interrupted_after_intent',
          detail: 'Process restarted after submit intent; outcome requires human reconciliation.',
          sessionGeneration: job.created_session_generation,
          createdAt: recoveredAt,
        });
        affectedBatchKeys.add(`${job.store_id}\u0000${job.batch_id}`);
        markedUnknown.push({
          storeId: job.store_id as AdExecutionRecoveryItem['storeId'],
          batchId: job.batch_id,
          jobId: job.id,
          missionId: job.mission_id,
          grantId: job.grant_id,
          previousStatus,
          status: 'unknown',
        });
      }

      // Also repair a prior crash that stopped after a pre-intent job became
      // blocked/cancelled/unknown but before its siblings were locked.
      const partialTerminalBatches = this.db.prepare(`
        SELECT DISTINCT terminal.store_id AS storeId, terminal.batch_id AS batchId
        FROM ad_execution_jobs terminal
        WHERE terminal.status IN ('blocked', 'unknown', 'cancelled')
          AND EXISTS (
            SELECT 1 FROM ad_execution_jobs sibling
            WHERE sibling.store_id = terminal.store_id
              AND sibling.batch_id = terminal.batch_id
              AND sibling.status IN ('queued', 'preflight')
          )
      `).all() as Array<{ storeId: string; batchId: string }>;
      partialTerminalBatches.forEach((item) => {
        affectedBatchKeys.add(`${item.storeId}\u0000${item.batchId}`);
      });

      for (const key of affectedBatchKeys) {
        const [storeId, batchId] = key.split('\u0000');
        if (!storeId || !batchId) continue;
        const siblings = this.db.prepare(`
          SELECT * FROM ad_execution_jobs
          WHERE store_id = ? AND batch_id = ? AND status IN ('queued', 'preflight')
          ORDER BY ordinal
        `).all(storeId, batchId) as JobRow[];
        for (const sibling of siblings) {
          const changed = this.db.prepare(`
            UPDATE ad_execution_jobs SET status = 'cancelled', revision = revision + 1,
              updated_at = ?, terminal_at = COALESCE(terminal_at, ?)
            WHERE store_id = ? AND id = ? AND revision = ?
              AND status IN ('queued', 'preflight')
          `).run(recoveredAt, recoveredAt, storeId, sibling.id, sibling.revision);
          if (changed.changes !== 1) {
            throw revisionConflict('Startup recovery lost a sibling cancellation CAS race.');
          }
          this.insertEvent({
            storeId,
            batchId,
            jobId: sibling.id,
            sequence: this.nextEventSequence(storeId, sibling.id),
            eventType: 'cancelled',
            fromStatus: sibling.status,
            toStatus: 'cancelled',
            actorId: 'startup-recovery',
            reasonCode: 'batch_recovered_terminal',
            detail: 'A terminal sibling locked this action before submit intent.',
            sessionGeneration: sibling.created_session_generation,
            createdAt: recoveredAt,
          });
        }
        this.refreshBatchStatus(storeId, batchId, recoveredAt);
      }

      const terminalBatches = this.db.prepare(`
        SELECT * FROM ad_execution_batches
        WHERE status IN ('succeeded', 'blocked', 'unknown', 'cancelled')
        ORDER BY store_id, created_at, id
      `).all() as BatchRow[];
      const revokedGrantIds: string[] = [];
      for (const batch of terminalBatches) {
        const inserted = this.ensureExecutionGrantTerminal(
          batch.store_id,
          batch.grant_id,
          batch.id,
          batch.status as Extract<AdExecutionStatus, 'succeeded' | 'blocked' | 'unknown' | 'cancelled'>,
          recoveredAt,
        );
        if (inserted && batch.status !== 'succeeded') revokedGrantIds.push(batch.grant_id);
      }
      const incompleteTerminalBatches = terminalBatches.filter((batch) => !this.db.prepare(`
        SELECT 1 FROM ad_execution_domain_reconciliations
        WHERE store_id = ? AND batch_id = ?
      `).get(batch.store_id, batch.id));
      const domainReconciliations = incompleteTerminalBatches.map((batch) => ({
        storeId: batch.store_id as AdExecutionRecoveryItem['storeId'],
        batchId: batch.id,
        missionId: batch.mission_id,
        grantId: batch.grant_id,
        status: batch.status as Extract<AdExecutionStatus, 'succeeded' | 'blocked' | 'unknown' | 'cancelled'>,
      }));
      const untouchedBeforeIntent = Number((this.db.prepare(`
        SELECT COUNT(*) AS count FROM ad_execution_jobs WHERE status IN ('queued', 'preflight')
      `).get() as { count: number }).count);
      return {
        recoveredAt,
        markedUnknown,
        revokedGrantIds,
        missionsRequiringStop: [...new Set(domainReconciliations
          .filter((item) => item.status !== 'succeeded')
          .map((item) => item.missionId))],
        domainReconciliations,
        untouchedBeforeIntent,
      };
    });
  }

  completeDomainReconciliation(
    contextInput: StoreContextEnvelope,
    batchIdInput: string,
  ): CompleteAdExecutionDomainReconciliationResult {
    const context = normalizeContext(contextInput);
    const batchId = idOf(batchIdInput, 'batchId');
    return this.immediate(() => {
      this.assertContext(context);
      const batch = this.db.prepare(`
        SELECT * FROM ad_execution_batches WHERE store_id = ? AND id = ?
      `).get(context.storeId, batchId) as BatchRow | undefined;
      if (!batch) throw notFound(`Execution batch ${batchId} was not found.`);
      if (!isTerminalAdExecutionStatus(batch.status)) {
        throw stateConflict(`Execution batch ${batchId} is not terminal.`);
      }

      this.ensureExecutionGrantTerminal(
        context.storeId,
        batch.grant_id,
        batch.id,
        batch.status,
        batch.terminal_at ?? this.timestamp(),
      );
      const grantTerminal = batch.status === 'succeeded' ? 'consumed' : 'revoked';
      const causalEventId = `causal:grant:${batch.grant_id}:${grantTerminal}`;
      if (!this.db.prepare(`
        SELECT 1 FROM causal_events WHERE store_id = ? AND id = ?
      `).get(context.storeId, causalEventId)) {
        throw referenceConflict(`Execution batch ${batchId} has no causal grant terminal event.`);
      }

      const evidenceRows = this.db.prepare(`
        SELECT evidence.*
        FROM ad_execution_evidence evidence
        JOIN ad_execution_jobs job
          ON job.store_id = evidence.store_id AND job.id = evidence.job_id
        WHERE evidence.store_id = ? AND evidence.batch_id = ?
        ORDER BY job.ordinal,
          CASE evidence.slot WHEN 'before' THEN 1 WHEN 'after' THEN 2 ELSE 3 END
      `).all(context.storeId, batchId) as EvidenceRow[];
      const completedAt = this.timestamp();
      for (const evidence of evidenceRows) {
        this.ensureCausalEvidenceRef(
          context.storeId,
          causalEventId,
          evidence,
          completedAt,
        );
      }

      const existing = this.db.prepare(`
        SELECT * FROM ad_execution_domain_reconciliations
        WHERE store_id = ? AND batch_id = ?
      `).get(context.storeId, batchId) as DomainReconciliationRow | undefined;
      if (existing) {
        if (existing.batch_status !== batch.status
          || existing.evidence_ref_count !== evidenceRows.length) {
          throw referenceConflict(`Execution batch ${batchId} reconciliation conflicts with its terminal ledger.`);
        }
        return { created: false, reconciliation: mapDomainReconciliation(existing) };
      }

      const id = `execution-domain-reconciliation:${hashObject([
        context.storeId,
        batchId,
      ]).slice(0, 48)}`;
      this.db.prepare(`
        INSERT INTO ad_execution_domain_reconciliations (
          id, store_id, batch_id, batch_status, evidence_ref_count,
          completed_session_generation, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        context.storeId,
        batchId,
        batch.status,
        evidenceRows.length,
        context.sessionGeneration,
        completedAt,
      );
      const reconciliation = this.db.prepare(`
        SELECT * FROM ad_execution_domain_reconciliations
        WHERE store_id = ? AND batch_id = ?
      `).get(context.storeId, batchId) as DomainReconciliationRow;
      return { created: true, reconciliation: mapDomainReconciliation(reconciliation) };
    });
  }

  private transition(
    contextInput: StoreContextEnvelope,
    input: Omit<AdExecutionJobTransitionRequest, 'context'>,
    allowedFrom: readonly AdExecutionStatus[],
    toStatus: AdExecutionStatus,
    eventType: AdExecutionEventType,
    actorId: string,
    reasonCode?: string,
    detail?: string,
    times: {
      intentWrittenAt?: string;
      submittedAt?: string;
      terminalAt?: string;
      submitIntentId?: string;
      commandFingerprint?: string;
    } = {},
    allowStaleJobSession = false,
  ): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
      this.assertContext(context);
      const job = this.requireMutableJob(
        context,
        input.jobId,
        input.expectedRevision,
        allowedFrom,
        allowStaleJobSession,
      );
      return this.applyTransition(context, job, toStatus, eventType, actorId, reasonCode, detail, times);
    });
  }

  private applyTransition(
    context: StoreContextEnvelope,
    job: JobRow,
    toStatus: AdExecutionStatus,
    eventType: AdExecutionEventType,
    actorId: string,
    reasonCode?: string,
    detail?: string,
    times: {
      intentWrittenAt?: string;
      submittedAt?: string;
      terminalAt?: string;
      submitIntentId?: string;
      commandFingerprint?: string;
    } = {},
  ): AdExecutionTransitionResult {
    if (isTerminalAdExecutionStatus(job.status)) {
      throw terminalState(`Execution job ${job.id} is terminal (${job.status}) and cannot transition.`);
    }
    const safeReasonCode = reasonCode === undefined ? undefined : idOf(reasonCode, 'reasonCode');
    const safeDetail = detail === undefined ? undefined : safeProjectionText(detail, 'detail');
    const updatedAt = this.timestamp();
    const changed = this.db.prepare(`
      UPDATE ad_execution_jobs SET status = ?, revision = revision + 1, updated_at = ?,
        submit_intent_id = COALESCE(?, submit_intent_id),
        command_fingerprint = COALESCE(?, command_fingerprint),
        intent_written_at = COALESCE(?, intent_written_at),
        submitted_at = COALESCE(?, submitted_at),
        terminal_at = COALESCE(?, terminal_at)
      WHERE store_id = ? AND id = ? AND revision = ? AND status = ?
    `).run(
      toStatus, updatedAt, times.submitIntentId ?? null, times.commandFingerprint ?? null,
      times.intentWrittenAt ?? null, times.submittedAt ?? null,
      times.terminalAt ?? null, context.storeId, job.id, job.revision, job.status,
    );
    if (changed.changes !== 1) throw revisionConflict(`Execution job ${job.id} lost its CAS transition.`);
    this.insertEvent({
      storeId: context.storeId,
      batchId: job.batch_id,
      jobId: job.id,
      sequence: this.nextEventSequence(context.storeId, job.id),
      eventType,
      fromStatus: job.status,
      toStatus,
      actorId,
      reasonCode: safeReasonCode,
      detail: safeDetail,
      sessionGeneration: context.sessionGeneration,
      createdAt: updatedAt,
    });
    const batch = this.refreshBatchStatus(context.storeId, job.batch_id, updatedAt);
    if (isTerminalAdExecutionStatus(batch.status)) {
      this.ensureExecutionGrantTerminal(
        context.storeId,
        job.grant_id,
        job.batch_id,
        batch.status,
        updatedAt,
      );
    }
    const projection = this.requireProjection(context.storeId, job.batch_id);
    const projectedJob = projection.jobs.find((item) => item.id === job.id);
    if (!projectedJob) throw notFound(`Execution job ${job.id} disappeared after transition.`);
    return {
      job: projectedJob,
      batch,
      missionId: job.mission_id,
      grantId: job.grant_id,
    };
  }

  private assertExactReadback(
    job: JobRow,
    input: Pick<RecordAdExecutionPreflightRequest,
      'pageIdentityHash' | 'canonicalKeywordId' | 'objectRevision'>,
  ): void {
    const pageIdentityHash = sha256Of(input.pageIdentityHash, 'pageIdentityHash');
    if (pageIdentityHash !== job.page_identity_hash
      || idOf(input.canonicalKeywordId, 'canonicalKeywordId') !== job.canonical_keyword_id
      || positiveInt(input.objectRevision, 'objectRevision') !== job.object_revision) {
      throw referenceConflict('Observed page identity or canonical object revision drifted from the job authority.');
    }
  }

  private assertEvidenceMatchesJob(job: JobRow, evidence: AdExecutionEvidenceInput): void {
    assertOpaqueExecutionArtifactRef(evidence.artifactRef);
    sha256Of(evidence.contentSha256, 'contentSha256');
    timestampOf(evidence.capturedAt, 'capturedAt');
    positiveInt(evidence.observedBidCents, 'observedBidCents');
    this.assertExactReadback(job, evidence);
  }

  private insertEvidence(
    context: StoreContextEnvelope,
    job: JobRow,
    slot: AdExecutionEvidenceSlot,
    evidence: AdExecutionEvidenceInput,
  ): void {
    const artifactRef = assertOpaqueExecutionArtifactRef(evidence.artifactRef);
    const createdAt = this.timestamp();
    const id = `exec-evidence-${hashObject([context.storeId, job.id, slot]).slice(0, 40)}`;
    try {
      this.db.prepare(`
        INSERT INTO ad_execution_evidence (
          id, store_id, batch_id, job_id, slot, artifact_ref, content_sha256,
          page_identity_hash, canonical_keyword_id, object_revision, observed_bid_cents,
          captured_session_generation, captured_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, context.storeId, job.batch_id, job.id, slot, artifactRef,
        sha256Of(evidence.contentSha256, 'contentSha256'),
        sha256Of(evidence.pageIdentityHash, 'pageIdentityHash'),
        idOf(evidence.canonicalKeywordId, 'canonicalKeywordId'),
        positiveInt(evidence.objectRevision, 'objectRevision'),
        positiveInt(evidence.observedBidCents, 'observedBidCents'),
        context.sessionGeneration, timestampOf(evidence.capturedAt, 'capturedAt'), createdAt,
      );
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) {
        throw stateConflict(`Execution evidence slot ${slot} is already sealed.`);
      }
      throw error;
    }
  }

  private requireMutableJob(
    context: StoreContextEnvelope,
    jobIdInput: string,
    expectedRevisionInput: number,
    allowedFrom: readonly AdExecutionStatus[],
    allowStaleJobSession = false,
  ): JobRow {
    const jobId = idOf(jobIdInput, 'jobId');
    const expectedRevision = positiveInt(expectedRevisionInput, 'expectedRevision');
    const row = this.db.prepare(`
      SELECT * FROM ad_execution_jobs WHERE store_id = ? AND id = ?
    `).get(context.storeId, jobId) as JobRow | undefined;
    if (!row) throw notFound(`Execution job ${jobId} was not found.`);
    if (row.revision !== expectedRevision) {
      throw revisionConflict(`Execution job revision is stale; expected ${row.revision}, received ${expectedRevision}.`);
    }
    if (!allowStaleJobSession && row.created_session_generation !== context.sessionGeneration) {
      throw new ExecutionAuthorityRepositoryError(
        'STALE_CONTEXT',
        'Execution job belongs to an earlier Amazon Ads session generation and must become UNKNOWN or terminal.',
      );
    }
    if (isTerminalAdExecutionStatus(row.status)) {
      throw terminalState(`Execution job ${jobId} is terminal (${row.status}) and cannot be retried.`);
    }
    const batch = this.db.prepare(`
      SELECT status FROM ad_execution_batches WHERE store_id = ? AND id = ?
    `).get(context.storeId, row.batch_id) as { status: AdExecutionStatus } | undefined;
    if (!batch) throw notFound(`Execution batch ${row.batch_id} was not found.`);
    if (isTerminalAdExecutionStatus(batch.status)) {
      throw terminalState(
        `Execution batch ${row.batch_id} is terminal (${batch.status}); remaining jobs cannot be retried.`,
      );
    }
    if (!allowedFrom.includes(row.status)) {
      throw stateConflict(`Execution job ${jobId} cannot transition from ${row.status}.`);
    }
    return row;
  }

  private requireGrant(context: StoreContextEnvelope, grantId: string): GrantRow {
    const row = this.db.prepare(`
      SELECT * FROM mission_grants WHERE store_id = ? AND id = ?
    `).get(context.storeId, grantId) as GrantRow | undefined;
    if (!row) throw notFound(`Mission grant ${grantId} was not found.`);
    if (row.marketplace !== 'US' || row.currency !== 'USD') throw stateConflict('Execution grant must use US/USD.');
    if (row.created_session_generation !== context.sessionGeneration) {
      throw new ExecutionAuthorityRepositoryError('STALE_CONTEXT', 'Execution grant belongs to a stale session generation.');
    }
    if (Date.parse(row.expires_at) <= this.now().getTime()) throw stateConflict('Execution grant has expired.');
    const grantEvents = this.db.prepare(`
      SELECT
        SUM(CASE WHEN event_type = 'issued' THEN 1 ELSE 0 END) AS issuedCount,
        SUM(CASE WHEN event_type IN ('revoked', 'consumed', 'expired') THEN 1 ELSE 0 END) AS terminalCount
      FROM mission_grant_events WHERE store_id = ? AND grant_id = ?
    `).get(context.storeId, grantId) as { issuedCount: number; terminalCount: number };
    if (Number(grantEvents.issuedCount) < 1 || Number(grantEvents.terminalCount) > 0) {
      throw stateConflict('Execution grant is missing issuance or is already terminal.');
    }
    const mission = this.db.prepare(`
      SELECT marketplace, currency, status, revision, policy_version_id AS policyVersionId
      FROM missions WHERE store_id = ? AND id = ?
    `).get(context.storeId, row.mission_id) as {
      marketplace: string; currency: string; status: string; revision: number; policyVersionId: string;
    } | undefined;
    if (!mission || mission.status !== 'active' || mission.marketplace !== 'US' || mission.currency !== 'USD'
      || mission.revision !== row.mission_revision || mission.policyVersionId !== row.policy_version_id) {
      throw stateConflict('Execution grant no longer matches an active Mission revision.');
    }
    const policy = this.db.prepare(`
      SELECT status, revision, rules_json AS rulesJson FROM policy_versions
      WHERE store_id = ? AND id = ?
    `).get(context.storeId, row.policy_version_id) as {
      status: string; revision: number; rulesJson: string;
    } | undefined;
    if (!policy || policy.status !== 'enabled' || policy.revision !== row.policy_revision) {
      throw stateConflict('Execution grant policy revision is not the enabled authority.');
    }
    const rules = objectOf(parseJson(policy.rulesJson, 'policy rules'));
    if (rules.killSwitch === true) throw stateConflict('Execution policy kill switch is enabled.');
    const runtime = this.db.prepare(`
      SELECT autonomy_mode AS autonomyMode, kill_switch AS killSwitch,
             circuit_breaker_state AS circuitBreakerState,
             active_policy_version_id AS activePolicyVersionId
      FROM policy_runtime WHERE store_id = ?
    `).get(context.storeId) as {
      autonomyMode: string; killSwitch: number; circuitBreakerState: string; activePolicyVersionId: string | null;
    } | undefined;
    if (!runtime || runtime.killSwitch !== 0 || runtime.circuitBreakerState !== 'closed'
      || runtime.activePolicyVersionId !== row.policy_version_id
      || (row.issuer_type === 'policy' && runtime.autonomyMode !== 'policy_auto')) {
      throw stateConflict('Execution policy runtime is not safe for this grant.');
    }
    return row;
  }

  private ensureCausalEvidenceRef(
    storeId: string,
    eventId: string,
    evidence: EvidenceRow,
    createdAt: string,
  ): void {
    const evidenceType = `ad_execution_${evidence.slot}`;
    const evidenceRef = assertOpaqueExecutionArtifactRef(evidence.artifact_ref);
    const id = `execution-evidence-ref:${hashObject([evidence.job_id, evidence.slot]).slice(0, 48)}`;
    const exact = (row: CausalEvidenceRefRow): boolean => (
      row.store_id === storeId
      && row.event_id === eventId
      && row.evidence_type === evidenceType
      && row.evidence_ref === evidenceRef
      && row.sha256 === evidence.content_sha256
    );
    const byId = this.db.prepare(`
      SELECT * FROM evidence_refs WHERE id = ?
    `).get(id) as CausalEvidenceRefRow | undefined;
    if (byId && !exact(byId)) {
      throw referenceConflict(`Execution evidence reference ${id} conflicts with existing lineage.`);
    }
    const byLineage = this.db.prepare(`
      SELECT * FROM evidence_refs
      WHERE store_id = ? AND event_id = ? AND evidence_type = ? AND evidence_ref = ?
    `).get(storeId, eventId, evidenceType, evidenceRef) as CausalEvidenceRefRow | undefined;
    if (byLineage && !exact(byLineage)) {
      throw referenceConflict(
        `Execution evidence ${evidence.job_id}/${evidence.slot} conflicts with existing proof.`,
      );
    }
    if (byId || byLineage) return;
    this.db.prepare(`
      INSERT INTO evidence_refs (
        id, store_id, event_id, evidence_type, evidence_ref, sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      storeId,
      eventId,
      evidenceType,
      evidenceRef,
      evidence.content_sha256,
      createdAt,
    );
  }

  private ensureExecutionGrantTerminal(
    storeId: string,
    grantId: string,
    batchId: string,
    batchStatus: Extract<AdExecutionStatus, 'succeeded' | 'blocked' | 'unknown' | 'cancelled'>,
    createdAt: string,
  ): boolean {
    const expectedEvent = batchStatus === 'succeeded' ? 'consumed' : 'revoked';
    const existing = this.db.prepare(`
      SELECT event_type AS eventType, actor_id AS actorId, reason, created_at AS createdAt
      FROM mission_grant_events
      WHERE store_id = ? AND grant_id = ?
        AND event_type IN ('revoked', 'consumed', 'expired')
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(storeId, grantId) as {
      eventType: string;
      actorId: string;
      reason: string | null;
      createdAt: string;
    } | undefined;
    if (existing) {
      if (existing.eventType !== expectedEvent) {
        throw stateConflict(
          `Execution batch ${batchId} is ${batchStatus}, but its grant is ${existing.eventType}.`,
        );
      }
      this.ensureExecutionGrantCausalEvent(
        storeId, grantId, batchId, expectedEvent,
        existing.actorId, existing.reason, existing.createdAt,
      );
      return false;
    }
    this.db.prepare(`
      INSERT INTO mission_grant_events (
        id, store_id, grant_id, event_type, actor_id, reason, created_at
      ) VALUES (?, ?, ?, ?, 'execution-ledger', ?, ?)
    `).run(
      `grant-execution-terminal-${hashObject([storeId, grantId, batchId, expectedEvent]).slice(0, 36)}`,
      storeId,
      grantId,
      expectedEvent,
      batchStatus === 'succeeded'
        ? 'Every execution job reached durable reload verification.'
        : `Execution batch reached terminal ${batchStatus}; grant cannot be reused.`,
      createdAt,
    );
    this.ensureExecutionGrantCausalEvent(
      storeId,
      grantId,
      batchId,
      expectedEvent,
      'execution-ledger',
      batchStatus === 'succeeded'
        ? 'Every execution job reached durable reload verification.'
        : `Execution batch reached terminal ${batchStatus}; grant cannot be reused.`,
      createdAt,
    );
    return true;
  }

  private ensureExecutionGrantCausalEvent(
    storeId: string,
    grantId: string,
    batchId: string,
    eventType: 'consumed' | 'revoked',
    actorId: string,
    reason: string | null,
    createdAt: string,
  ): void {
    const id = `causal:grant:${grantId}:${eventType}`;
    const existing = this.db.prepare(`
      SELECT 1 FROM causal_events WHERE store_id = ? AND id = ?
    `).get(storeId, id);
    if (existing) return;
    const authority = this.db.prepare(`
      SELECT grant.mission_id AS missionId, mission.business_date AS businessDate,
             batch.created_session_generation AS sessionGeneration
      FROM mission_grants grant
      JOIN missions mission ON mission.store_id = grant.store_id AND mission.id = grant.mission_id
      JOIN ad_execution_batches batch ON batch.store_id = grant.store_id
        AND batch.grant_id = grant.id AND batch.id = ?
      WHERE grant.store_id = ? AND grant.id = ?
    `).get(batchId, storeId, grantId) as {
      missionId: string;
      businessDate: string;
      sessionGeneration: number;
    } | undefined;
    if (!authority) throw referenceConflict('Execution grant causal authority is incomplete.');
    const sequence = Number((this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
      FROM causal_events WHERE store_id = ?
    `).get(storeId) as { nextSequence: number }).nextSequence);
    this.db.prepare(`
      INSERT INTO causal_events (
        id, store_id, stage, event_type, entity_type, entity_id,
        mission_id, title, signal, intervention, expected_effect, observed_effect,
        confidence, status, source, actor_id, business_date,
        session_generation, corrects_event_id, sequence, created_at
      ) VALUES (?, ?, ?, ?, 'mission_grant', ?, ?, ?, NULL, ?, NULL, NULL,
        NULL, ?, 'execution-ledger', ?, ?, ?, NULL, ?, ?)
    `).run(
      id,
      storeId,
      eventType === 'consumed' ? 'ACTION' : 'DECISION',
      `mission_grant_${eventType}`,
      grantId,
      authority.missionId,
      `MissionGrant ${eventType}`,
      reason,
      eventType,
      idOf(actorId, 'actorId'),
      authority.businessDate,
      authority.sessionGeneration,
      sequence,
      createdAt,
    );
  }

  private requireProposalDecision(context: StoreContextEnvelope, decisionId: string): ProposalDecisionRow {
    const row = this.db.prepare(`
      SELECT
        proposal.id AS proposal_id, proposal.marketplace, proposal.currency,
        proposal.mission_id, proposal.mission_revision, proposal.policy_version_id,
        proposal.policy_revision, proposal.action_revision, proposal.action_type,
        proposal.entity_type, proposal.ad_entity_id, proposal.ad_entity_revision,
        proposal.current_bid_cents, proposal.proposed_bid_cents, proposal.change_pct,
        proposal.authorization_json, proposal.valid_until, proposal.created_session_generation,
        decision.id AS decision_id, decision.revision AS decision_revision,
        decision.status AS decision_status, decision.action_type AS decision_action_type,
        decision.ad_entity_id AS decision_ad_entity_id,
        decision.action_revision AS decision_action_revision,
        decision.policy_version_id AS decision_policy_version_id,
        decision.policy_revision AS decision_policy_revision,
        decision.valid_until AS decision_valid_until
      FROM analysis_proposal_decision_links link
      JOIN analysis_proposal_snapshots proposal
        ON proposal.store_id = link.store_id AND proposal.id = link.proposal_id
      JOIN decisions decision
        ON decision.store_id = link.store_id AND decision.id = link.decision_id
      WHERE link.store_id = ? AND link.decision_id = ?
    `).get(context.storeId, idOf(decisionId, 'decisionId')) as ProposalDecisionRow | undefined;
    if (!row) throw notFound(`Approved decision ${decisionId} has no immutable Stage 5 proposal link.`);
    return row;
  }

  private validateProposalDecision(context: StoreContextEnvelope, grant: GrantRow, row: ProposalDecisionRow): void {
    const exact = row.marketplace === 'US' && row.currency === 'USD'
      && row.mission_id === grant.mission_id
      && row.mission_revision === grant.mission_revision
      && row.policy_version_id === grant.policy_version_id
      && row.policy_revision === grant.policy_revision
      && row.action_revision === grant.action_revision
      && row.action_type === AD_EXECUTION_ACTION_TYPE
      && row.entity_type === 'keyword'
      && row.decision_status === 'approved'
      && row.decision_action_type === AD_EXECUTION_ACTION_TYPE
      && row.decision_ad_entity_id === row.ad_entity_id
      && row.decision_action_revision === grant.action_revision
      && row.decision_policy_version_id === grant.policy_version_id
      && row.decision_policy_revision === grant.policy_revision
      && row.created_session_generation === context.sessionGeneration;
    if (!exact) throw referenceConflict('Grant, proposal, decision, policy, Mission, or action revision does not match exactly.');
    if (Date.parse(row.valid_until) <= this.now().getTime()
      || (row.decision_valid_until && Date.parse(row.decision_valid_until) <= this.now().getTime())) {
      throw stateConflict('Linked proposal or decision has expired.');
    }
    const authorization = objectOf(parseJson(row.authorization_json, 'proposal authorization'));
    const lane = objectOf(authorization[grant.issuer_type]);
    if (lane.eligible !== true || (Array.isArray(lane.blockers) && lane.blockers.length > 0)) {
      throw stateConflict(`Proposal is not eligible for ${grant.issuer_type} authorization.`);
    }
  }

  private requireLatestIdentityForEntity(
    context: StoreContextEnvelope,
    adEntityId: string,
    entityRevision: number,
  ): AdKeywordIdentityVersionRecord {
    const latestAuthority = this.db.prepare(`
      SELECT entity_revision AS revision FROM verified_ad_entity_authority
      WHERE store_id = ? AND ad_entity_id = ?
      ORDER BY entity_revision DESC, created_at DESC, authority_id DESC LIMIT 1
    `).get(context.storeId, adEntityId) as { revision: number } | undefined;
    if (!latestAuthority || latestAuthority.revision !== entityRevision) {
      throw revisionConflict('Proposal is not bound to the latest Stage 5 Ads entity revision.');
    }
    const row = this.db.prepare(`
      SELECT identity.* FROM ad_keyword_identity_versions identity
      WHERE identity.store_id = ? AND identity.ad_entity_id = ? AND identity.entity_revision = ?
      ORDER BY identity.object_revision DESC, identity.created_at DESC, identity.identity_version_id DESC
      LIMIT 1
    `).get(context.storeId, adEntityId, entityRevision) as IdentityRow | undefined;
    if (!row) throw referenceConflict('Proposal has no latest canonical keyword identity for its Stage 5 entity revision.');
    const identity = mapIdentity(row);
    if (identity.resolvedSessionGeneration !== context.sessionGeneration) {
      throw new ExecutionAuthorityRepositoryError(
        'STALE_CONTEXT',
        'Canonical keyword identity must be resolved again in the current Amazon Ads session generation.',
      );
    }
    return identity;
  }

  private assertContext(contextInput: StoreContextEnvelope, expectedAdsAccountId?: string): StoreContextEnvelope {
    const context = normalizeContext(contextInput);
    const store = this.db.prepare(`
      SELECT browser_profile_id AS browserProfileId, marketplace, currency,
             business_timezone AS businessTimezone, status
      FROM stores WHERE store_id = ?
    `).get(context.storeId) as {
      browserProfileId: string; marketplace: string; currency: string; businessTimezone: string; status: string;
    } | undefined;
    if (!store || store.browserProfileId !== context.browserProfileId
      || store.marketplace !== 'US' || context.marketplace !== 'US'
      || store.currency !== 'USD' || context.currency !== 'USD'
      || store.businessTimezone !== context.businessTimezone) {
      throw new ExecutionAuthorityRepositoryError(
        'INVALID_CONTEXT', 'StoreContextEnvelope does not match SQLite execution authority.',
      );
    }
    if (store.status !== 'active') {
      throw new ExecutionAuthorityRepositoryError(
        'STORE_NOT_ACTIVE', `Store ${context.storeId} is ${store.status}; execution is blocked.`,
      );
    }
    const setting = this.db.prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(`store_session_generation:${context.storeId}`) as { value: string | null } | undefined;
    const durable = setting?.value === undefined || setting.value === null
      ? Number((this.db.prepare(`
          SELECT COALESCE(MAX(session_generation), 0) AS generation
          FROM store_session_metadata WHERE store_id = ?
        `).get(context.storeId) as { generation: number }).generation)
      : Number(setting.value);
    if (!Number.isSafeInteger(durable) || durable < 0 || durable !== context.sessionGeneration) {
      throw new ExecutionAuthorityRepositoryError(
        'STALE_CONTEXT',
        `Store session generation is stale; expected ${durable}, received ${context.sessionGeneration}.`,
      );
    }
    const connection = this.db.prepare(`
      SELECT status, external_account_id AS externalAccountId FROM store_connections
      WHERE store_id = ? AND provider = 'amazon_ads'
    `).get(context.storeId) as { status: string; externalAccountId: string | null } | undefined;
    const session = this.db.prepare(`
      SELECT browser_profile_id AS browserProfileId, status, session_generation AS sessionGeneration,
             external_account_id AS externalAccountId
      FROM store_session_metadata WHERE store_id = ? AND provider = 'amazon_ads'
    `).get(context.storeId) as {
      browserProfileId: string; status: string; sessionGeneration: number; externalAccountId: string | null;
    } | undefined;
    if (!connection || connection.status !== 'ready' || !connection.externalAccountId
      || !session || session.status !== 'ready' || session.browserProfileId !== context.browserProfileId
      || session.sessionGeneration !== context.sessionGeneration
      || session.externalAccountId !== connection.externalAccountId
      || (expectedAdsAccountId !== undefined
        && idOf(expectedAdsAccountId, 'adsAccountId') !== connection.externalAccountId)) {
      throw new ExecutionAuthorityRepositoryError(
        'INVALID_CONTEXT', 'Amazon Ads account/session identity is not ready or does not match exactly.',
      );
    }
    return context;
  }

  private requireIdentityVersion(
    storeId: string,
    canonicalKeywordId: string,
    objectRevision: number,
  ): AdKeywordIdentityVersionRecord {
    const row = this.db.prepare(`
      SELECT * FROM ad_keyword_identity_versions
      WHERE store_id = ? AND canonical_keyword_id = ? AND object_revision = ?
    `).get(storeId, canonicalKeywordId, objectRevision) as IdentityRow | undefined;
    if (!row) throw notFound('Canonical keyword identity revision was not found.');
    return mapIdentity(row);
  }

  private requireProjection(storeId: string, batchId: string): AdExecutionBatchProjection {
    const batchRow = this.db.prepare(`
      SELECT * FROM ad_execution_batches WHERE store_id = ? AND id = ?
    `).get(storeId, batchId) as BatchRow | undefined;
    if (!batchRow) throw notFound(`Execution batch ${batchId} was not found.`);
    const jobs = (this.db.prepare(`
      SELECT * FROM ad_execution_jobs WHERE store_id = ? AND batch_id = ? ORDER BY ordinal
    `).all(storeId, batchId) as JobRow[]).map((row): AdExecutionJobProjection => ({
      ...mapJob(row),
      evidence: (this.db.prepare(`
        SELECT * FROM ad_execution_evidence WHERE store_id = ? AND job_id = ?
        ORDER BY CASE slot WHEN 'before' THEN 1 WHEN 'after' THEN 2 WHEN 'reload' THEN 3 END
      `).all(storeId, row.id) as EvidenceRow[]).map(mapEvidence),
      events: (this.db.prepare(`
        SELECT * FROM ad_execution_events WHERE store_id = ? AND job_id = ? ORDER BY sequence
      `).all(storeId, row.id) as EventRow[]).map(mapEvent),
    }));
    return { batch: mapBatch(batchRow), jobs };
  }

  private insertEvent(input: {
    storeId: string;
    batchId: string;
    jobId: string;
    sequence: number;
    eventType: AdExecutionEventType;
    fromStatus: AdExecutionStatus;
    toStatus: AdExecutionStatus;
    actorId: string;
    reasonCode?: string;
    detail?: string;
    sessionGeneration: number;
    createdAt: string;
  }): void {
    const eventId = `exec-event-${hashObject([input.storeId, input.jobId, input.sequence, input.eventType]).slice(0, 40)}`;
    this.db.prepare(`
      INSERT INTO ad_execution_events (
        id, store_id, batch_id, job_id, sequence, event_type, from_status, to_status,
        actor_id, reason_code, detail, session_generation, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId, input.storeId, input.batchId, input.jobId, input.sequence,
      input.eventType, input.fromStatus, input.toStatus, idOf(input.actorId, 'actorId'),
      optionalText(input.reasonCode), optionalText(input.detail), input.sessionGeneration, input.createdAt,
    );
  }

  private nextEventSequence(storeId: string, jobId: string): number {
    return Number((this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
      FROM ad_execution_events WHERE store_id = ? AND job_id = ?
    `).get(storeId, jobId) as { sequence: number }).sequence);
  }

  private refreshBatchStatus(storeId: string, batchId: string, updatedAt: string): AdExecutionBatchRecord {
    const rows = this.db.prepare(`
      SELECT status FROM ad_execution_jobs WHERE store_id = ? AND batch_id = ? ORDER BY ordinal
    `).all(storeId, batchId) as Array<{ status: AdExecutionStatus }>;
    if (rows.length === 0) throw stateConflict('Execution batch has no jobs.');
    const statuses = rows.map((row) => row.status);
    let status: AdExecutionStatus;
    if (statuses.includes('unknown')) status = 'unknown';
    else if (statuses.every((value) => value === 'succeeded')) status = 'succeeded';
    else if (statuses.every(isTerminalAdExecutionStatus)) {
      status = statuses.includes('blocked') ? 'blocked' : statuses.includes('cancelled') ? 'cancelled' : 'succeeded';
    } else if (statuses.includes('verifying')) status = 'verifying';
    else if (statuses.includes('submitted')) status = 'submitted';
    else if (statuses.includes('intent_written')) status = 'intent_written';
    else if (statuses.includes('preflight')) status = 'preflight';
    else status = 'queued';
    const terminalAt = isTerminalAdExecutionStatus(status) ? updatedAt : null;
    this.db.prepare(`
      UPDATE ad_execution_batches SET status = ?, revision = revision + 1,
        updated_at = ?, terminal_at = COALESCE(?, terminal_at)
      WHERE store_id = ? AND id = ?
    `).run(status, updatedAt, terminalAt, storeId, batchId);
    const row = this.db.prepare(`
      SELECT * FROM ad_execution_batches WHERE store_id = ? AND id = ?
    `).get(storeId, batchId) as BatchRow;
    return mapBatch(row);
  }

  private immediate<T>(work: () => T): T {
    return this.db.transaction(work).immediate();
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function mapIdentity(row: IdentityRow): AdKeywordIdentityVersionRecord {
  return {
    identityVersionId: row.identity_version_id,
    storeId: row.store_id as AdKeywordIdentityVersionRecord['storeId'],
    marketplace: row.marketplace,
    currency: row.currency,
    canonicalKeywordId: row.canonical_keyword_id,
    adEntityId: row.ad_entity_id,
    entityRevision: row.entity_revision,
    adsAccountId: row.ads_account_id,
    campaignId: row.campaign_id,
    adGroupId: row.ad_group_id,
    keywordId: row.keyword_id,
    objectRevision: row.object_revision,
    observedBidCents: row.observed_bid_cents,
    pageIdentityHash: row.page_identity_hash,
    sourceAuthorityId: row.source_authority_id,
    sourceAuthorityProofSha256: row.source_authority_proof_sha256,
    resolutionProofSha256: row.resolution_proof_sha256,
    resolvedSessionGeneration: row.resolved_session_generation,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
  };
}

function mapAlias(row: AliasRow): AdKeywordAliasResolutionRecord {
  return {
    id: row.id,
    storeId: row.store_id as AdKeywordAliasResolutionRecord['storeId'],
    aliasType: row.alias_type,
    aliasHash: row.alias_hash,
    canonicalKeywordId: row.canonical_keyword_id,
    objectRevision: row.object_revision,
    resolutionRevision: row.resolution_revision,
    status: row.status,
    reason: row.reason ?? undefined,
    resolvedSessionGeneration: row.resolved_session_generation,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

function mapBatch(row: BatchRow): AdExecutionBatchRecord {
  return {
    id: row.id,
    storeId: row.store_id as AdExecutionBatchRecord['storeId'],
    marketplace: row.marketplace,
    currency: row.currency,
    missionId: row.mission_id,
    missionRevision: row.mission_revision,
    grantId: row.grant_id,
    actionRevision: row.action_revision,
    status: row.status,
    revision: row.revision,
    createdSessionGeneration: row.created_session_generation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    terminalAt: row.terminal_at ?? undefined,
  };
}

function mapJob(row: JobRow): AdExecutionJobRecord {
  return {
    id: row.id,
    storeId: row.store_id as AdExecutionJobRecord['storeId'],
    batchId: row.batch_id,
    ordinal: row.ordinal,
    missionId: row.mission_id,
    grantId: row.grant_id,
    proposalId: row.proposal_id,
    decisionId: row.decision_id,
    decisionRevision: row.decision_revision,
    actionRevision: row.action_revision,
    actionType: row.action_type,
    canonicalKeywordId: row.canonical_keyword_id,
    adEntityId: row.ad_entity_id,
    entityRevision: row.entity_revision,
    identity: {
      storeId: row.store_id as AdExecutionJobRecord['storeId'],
      marketplace: 'US',
      currency: 'USD',
      adsAccountId: row.ads_account_id,
      campaignId: row.campaign_id,
      adGroupId: row.ad_group_id,
      keywordId: row.keyword_id,
      objectRevision: row.object_revision,
    },
    pageIdentityHash: row.page_identity_hash,
    expectedBidCents: row.expected_bid_cents,
    targetBidCents: row.target_bid_cents,
    changePct: row.change_pct,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    revision: row.revision,
    createdSessionGeneration: row.created_session_generation,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submitIntentId: row.submit_intent_id ?? undefined,
    commandFingerprint: row.command_fingerprint ?? undefined,
    intentWrittenAt: row.intent_written_at ?? undefined,
    submittedAt: row.submitted_at ?? undefined,
    terminalAt: row.terminal_at ?? undefined,
  };
}

function mapEvent(row: EventRow): AdExecutionEventRecord {
  return {
    id: row.id,
    storeId: row.store_id as AdExecutionEventRecord['storeId'],
    batchId: row.batch_id,
    jobId: row.job_id,
    sequence: row.sequence,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorId: row.actor_id,
    reasonCode: row.reason_code ?? undefined,
    detail: row.detail ?? undefined,
    sessionGeneration: row.session_generation,
    createdAt: row.created_at,
  };
}

function mapEvidence(row: EvidenceRow): AdExecutionEvidenceRecord {
  return {
    id: row.id,
    storeId: row.store_id as AdExecutionEvidenceRecord['storeId'],
    batchId: row.batch_id,
    jobId: row.job_id,
    slot: row.slot,
    artifactRef: row.artifact_ref,
    contentSha256: row.content_sha256,
    pageIdentityHash: row.page_identity_hash,
    canonicalKeywordId: row.canonical_keyword_id,
    objectRevision: row.object_revision,
    observedBidCents: row.observed_bid_cents,
    capturedSessionGeneration: row.captured_session_generation,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  };
}

function mapDomainReconciliation(
  row: DomainReconciliationRow,
): AdExecutionDomainReconciliationRecord {
  return {
    id: row.id,
    storeId: row.store_id as AdExecutionDomainReconciliationRecord['storeId'],
    batchId: row.batch_id,
    batchStatus: row.batch_status,
    evidenceRefCount: row.evidence_ref_count,
    completedSessionGeneration: row.completed_session_generation,
    completedAt: row.completed_at,
  };
}

function normalizeContext(input: StoreContextEnvelope): StoreContextEnvelope {
  try {
    return normalizeStoreContextEnvelope(input);
  } catch (error) {
    throw new ExecutionAuthorityRepositoryError(
      'INVALID_CONTEXT', error instanceof Error ? error.message : 'StoreContextEnvelope is invalid.',
    );
  }
}

function idOf(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f]/.test(normalized)) {
    throw invalid(`${field} must be a non-empty identifier.`);
  }
  return normalized;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 2000) : null;
}

function safeProjectionText(value: unknown, field: string): string {
  const normalized = idOf(value, field);
  if (/[\\/<>?&=]/.test(normalized)
    || /(?:https?|file):/i.test(normalized)
    || /(?:document\.)?cookie/i.test(normalized)) {
    throw invalid(`${field} must not contain paths, URLs, query data, cookies, or HTML.`);
  }
  return normalized;
}

function positiveInt(value: unknown, field: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) throw invalid(`${field} must be a positive integer.`);
  return normalized;
}

function finite(value: unknown, field: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw invalid(`${field} must be finite.`);
  return normalized;
}

function sha256Of(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw invalid(`${field} must be a SHA-256 hex digest.`);
  return normalized;
}

function timestampOf(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  const parsed = Date.parse(normalized);
  if (!normalized || !Number.isFinite(parsed)) throw invalid(`${field} must be an ISO timestamp.`);
  return new Date(parsed).toISOString();
}

function parseJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw stateConflict(`${field} is invalid JSON.`);
  }
}

function objectOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw stateConflict('Expected an authority object.');
  return value as Record<string, unknown>;
}

function uniqueStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw stateConflict('Expected an authority string array.');
  const result = value.map((item) => idOf(item, 'authority item'));
  if (new Set(result).size !== result.length) throw stateConflict('Authority array contains duplicates.');
  return result;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function hashObject(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function invalid(message: string): ExecutionAuthorityRepositoryError {
  return new ExecutionAuthorityRepositoryError('INVALID_INPUT', message);
}

function notFound(message: string): ExecutionAuthorityRepositoryError {
  return new ExecutionAuthorityRepositoryError('NOT_FOUND', message);
}

function referenceConflict(message: string): ExecutionAuthorityRepositoryError {
  return new ExecutionAuthorityRepositoryError('REFERENCE_CONFLICT', message);
}

function stateConflict(message: string): ExecutionAuthorityRepositoryError {
  return new ExecutionAuthorityRepositoryError('STATE_CONFLICT', message);
}

function revisionConflict(message: string): ExecutionAuthorityRepositoryError {
  return new ExecutionAuthorityRepositoryError('REVISION_CONFLICT', message);
}

function terminalState(message: string): ExecutionAuthorityRepositoryError {
  return new ExecutionAuthorityRepositoryError('TERMINAL_STATE', message);
}
