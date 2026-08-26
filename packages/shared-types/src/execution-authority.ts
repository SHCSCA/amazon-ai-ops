import type { StoreContextEnvelope, StoreId, UsCurrency, UsMarketplace } from './store';

/** Stage 6 V1 is deliberately limited to a verified US keyword bid decrease. */
export const AD_EXECUTION_ACTION_TYPE = 'set_keyword_bid' as const;
export const MAX_AD_EXECUTION_ACTIONS_PER_BATCH = 10 as const;

export const AD_EXECUTION_STATUSES = [
  'queued',
  'preflight',
  'intent_written',
  'submitted',
  'verifying',
  'succeeded',
  'blocked',
  'unknown',
  'cancelled',
] as const;

export type AdExecutionStatus = (typeof AD_EXECUTION_STATUSES)[number];
export type AdExecutionTerminalStatus = Extract<
  AdExecutionStatus,
  'succeeded' | 'blocked' | 'unknown' | 'cancelled'
>;

export const AD_EXECUTION_EVIDENCE_SLOTS = ['before', 'after', 'reload'] as const;
export type AdExecutionEvidenceSlot = (typeof AD_EXECUTION_EVIDENCE_SLOTS)[number];

export interface CanonicalKeywordIdentity {
  storeId: StoreId;
  marketplace: UsMarketplace;
  currency: UsCurrency;
  adsAccountId: string;
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  objectRevision: number;
}

/**
 * Append-only resolution of a Stage 5 opaque entity into exact Amazon Ads ids.
 * Paths, URLs, HTML, cookies, and browser state are intentionally absent.
 */
export interface AdKeywordIdentityVersionRecord extends CanonicalKeywordIdentity {
  identityVersionId: string;
  canonicalKeywordId: string;
  adEntityId: string;
  entityRevision: number;
  observedBidCents: number;
  pageIdentityHash: string;
  /** Immutable Stage 5 authority used as the source binding. */
  sourceAuthorityId: string;
  sourceAuthorityProofSha256: string;
  /** Proof captured by the current exact Ads-page/API identity resolution. */
  resolutionProofSha256: string;
  resolvedSessionGeneration: number;
  resolvedAt: string;
  resolvedBy: string;
  createdAt: string;
}

export interface RegisterAdKeywordIdentityInput {
  adEntityId: string;
  entityRevision: number;
  adsAccountId: string;
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  observedBidCents: number;
  pageIdentityHash: string;
  resolutionProofSha256: string;
  resolvedAt: string;
  resolvedBy: string;
}

export interface ResolveCanonicalKeywordInput {
  adsAccountId: string;
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  expectedObjectRevision?: number;
}

export type AdKeywordAliasType =
  | 'stage5_ad_entity'
  | 'legacy_writable_target'
  | 'operator_label';

export type AdKeywordAliasResolutionStatus = 'resolved' | 'rejected' | 'superseded';

export interface AdKeywordAliasResolutionRecord {
  id: string;
  storeId: StoreId;
  aliasType: AdKeywordAliasType;
  /** SHA-256 of the normalized alias; raw UI labels are not authority. */
  aliasHash: string;
  canonicalKeywordId: string;
  objectRevision: number;
  resolutionRevision: number;
  status: AdKeywordAliasResolutionStatus;
  reason?: string;
  resolvedSessionGeneration: number;
  resolvedAt: string;
  resolvedBy: string;
}

export interface RecordAdKeywordAliasResolutionInput {
  id: string;
  aliasType: AdKeywordAliasType;
  aliasHash: string;
  canonicalKeywordId: string;
  objectRevision: number;
  status: AdKeywordAliasResolutionStatus;
  reason?: string;
  resolvedAt: string;
  resolvedBy: string;
}

export interface AdExecutionBatchRecord {
  id: string;
  storeId: StoreId;
  marketplace: UsMarketplace;
  currency: UsCurrency;
  missionId: string;
  missionRevision: number;
  grantId: string;
  actionRevision: number;
  status: AdExecutionStatus;
  revision: number;
  createdSessionGeneration: number;
  createdAt: string;
  updatedAt: string;
  terminalAt?: string;
}

export interface AdExecutionJobRecord {
  id: string;
  storeId: StoreId;
  batchId: string;
  ordinal: number;
  missionId: string;
  grantId: string;
  proposalId: string;
  decisionId: string;
  decisionRevision: number;
  actionRevision: number;
  actionType: typeof AD_EXECUTION_ACTION_TYPE;
  canonicalKeywordId: string;
  adEntityId: string;
  entityRevision: number;
  identity: CanonicalKeywordIdentity;
  pageIdentityHash: string;
  expectedBidCents: number;
  targetBidCents: number;
  changePct: number;
  idempotencyKey: string;
  status: AdExecutionStatus;
  revision: number;
  createdSessionGeneration: number;
  createdAt: string;
  updatedAt: string;
  /** Canonical Main-generated intent id, persisted atomically before click. */
  submitIntentId?: string;
  /** SHA-256 of the complete canonical executor command persisted before click. */
  commandFingerprint?: string;
  intentWrittenAt?: string;
  submittedAt?: string;
  terminalAt?: string;
}

export type AdExecutionEventType =
  | 'queued'
  | 'started'
  | 'preflight_verified'
  | 'submit_intent_recorded'
  | 'submitted'
  | 'after_recorded'
  | 'reload_verified'
  | 'blocked'
  | 'unknown'
  | 'cancelled';

export interface AdExecutionEventRecord {
  id: string;
  storeId: StoreId;
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
}

export interface AdExecutionEvidenceRecord {
  id: string;
  storeId: StoreId;
  batchId: string;
  jobId: string;
  slot: AdExecutionEvidenceSlot;
  /** Logical artifact id resolved only inside Main. */
  artifactRef: string;
  contentSha256: string;
  pageIdentityHash: string;
  canonicalKeywordId: string;
  objectRevision: number;
  observedBidCents: number;
  capturedSessionGeneration: number;
  capturedAt: string;
  createdAt: string;
}

export interface AdExecutionEvidenceInput {
  artifactRef: string;
  contentSha256: string;
  pageIdentityHash: string;
  canonicalKeywordId: string;
  objectRevision: number;
  observedBidCents: number;
  capturedAt: string;
}

/** Renderer-safe projection. It contains hashes and opaque ids, never local paths. */
export interface AdExecutionJobProjection extends AdExecutionJobRecord {
  evidence: readonly AdExecutionEvidenceRecord[];
  events: readonly AdExecutionEventRecord[];
}

export interface AdExecutionBatchProjection {
  batch: AdExecutionBatchRecord;
  jobs: readonly AdExecutionJobProjection[];
}

export interface CreateAdExecutionBatchRequest {
  context: StoreContextEnvelope;
  grantId: string;
}

export interface CreateAdExecutionBatchResult {
  created: boolean;
  projection: AdExecutionBatchProjection;
}

export interface ResolveAdExecutionIdentityRequest {
  context: StoreContextEnvelope;
  grantId: string;
  /** Stage 5 opaque authority id; never a Renderer-supplied selector. */
  adEntityId: string;
}

export interface StartAdExecutionBatchRequest {
  context: StoreContextEnvelope;
  batchId: string;
}

export interface CancelAdExecutionBatchRequest extends StartAdExecutionBatchRequest {
  reason?: string;
}

export interface ReconcileUnknownAdExecutionBatchRequest extends StartAdExecutionBatchRequest {}

export type AdExecutionUnknownReconciliationStatus =
  | 'CONFIRMED_TARGET'
  | 'CONFIRMED_ORIGINAL'
  | 'CURRENT_VALUE_DRIFT'
  | 'STILL_UNKNOWN';

/**
 * Read-only reconciliation result for a terminal UNKNOWN batch. The original
 * execution ledger remains UNKNOWN; Main appends a separate READBACK fact and
 * never retries the saved command.
 */
export interface AdExecutionUnknownReconciliationResult {
  status: AdExecutionUnknownReconciliationStatus;
  batchId: string;
  jobId: string;
  originalStatus: 'unknown';
  firstObservedBidCents: number;
  reloadObservedBidCents: number;
  observedBidCents: number;
  observedAt: string;
  firstEvidenceRef: string;
  reloadEvidenceRef: string;
  detail: string;
}

export interface AdExecutionTakeoverResult {
  status: 'VISIBLE';
  batchId: string;
}

export interface AdExecutionProgressEvent {
  storeId: StoreId;
  batchId: string;
  jobId?: string;
  phase: 'identity' | 'queue' | 'preflight' | 'submit' | 'readback' | 'terminal' | 'takeover';
  status: AdExecutionStatus | 'resolving' | 'ready';
  message: string;
  occurredAt: string;
}

export interface AdExecutionJobTransitionRequest {
  context: StoreContextEnvelope;
  jobId: string;
  expectedRevision: number;
}

export interface RecordAdExecutionPreflightRequest extends AdExecutionJobTransitionRequest {
  observedBidCents: number;
  pageIdentityHash: string;
  canonicalKeywordId: string;
  objectRevision: number;
}

export interface RecordAdExecutionSubmitIntentRequest extends AdExecutionJobTransitionRequest {
  before: AdExecutionEvidenceInput;
  submitIntentId: string;
  commandFingerprint: string;
}

export interface RecordAdExecutionEvidenceRequest extends AdExecutionJobTransitionRequest {
  evidence: AdExecutionEvidenceInput;
}

export interface MarkAdExecutionTerminalRequest extends AdExecutionJobTransitionRequest {
  reasonCode: string;
  detail?: string;
}

export interface AdExecutionTransitionResult {
  job: AdExecutionJobProjection;
  batch: AdExecutionBatchRecord;
  missionId: string;
  grantId: string;
}

export interface AdExecutionRecoveryItem {
  storeId: StoreId;
  batchId: string;
  jobId: string;
  missionId: string;
  grantId: string;
  previousStatus: Extract<AdExecutionStatus, 'intent_written' | 'submitted' | 'verifying'>;
  status: 'unknown';
}

export interface AdExecutionDomainReconciliationItem {
  storeId: StoreId;
  batchId: string;
  missionId: string;
  grantId: string;
  status: Extract<AdExecutionTerminalStatus, 'succeeded' | 'blocked' | 'unknown' | 'cancelled'>;
}

/** Durable proof that Main finished projecting one terminal execution batch into the Mission domain. */
export interface AdExecutionDomainReconciliationRecord {
  id: string;
  storeId: StoreId;
  batchId: string;
  batchStatus: AdExecutionTerminalStatus;
  evidenceRefCount: number;
  completedSessionGeneration: number;
  completedAt: string;
}

export interface CompleteAdExecutionDomainReconciliationResult {
  created: boolean;
  reconciliation: AdExecutionDomainReconciliationRecord;
}

export interface AdExecutionStartupRecoveryResult {
  recoveredAt: string;
  markedUnknown: readonly AdExecutionRecoveryItem[];
  /** Grants atomically revoked by startup recovery before any new work can use them. */
  revokedGrantIds: readonly string[];
  /** Main must finish the domain stop/pause through the Mission state machine. */
  missionsRequiringStop: readonly string[];
  /** Re-emitted on startup only until Main durably completes the domain projection. */
  domainReconciliations: readonly AdExecutionDomainReconciliationItem[];
  untouchedBeforeIntent: number;
}

export function isTerminalAdExecutionStatus(value: AdExecutionStatus): value is AdExecutionTerminalStatus {
  return value === 'succeeded' || value === 'blocked' || value === 'unknown' || value === 'cancelled';
}

export function assertCanonicalKeywordIdentity(value: CanonicalKeywordIdentity): void {
  if (!value || typeof value !== 'object') throw new TypeError('canonical keyword identity is required');
  requiredId(value.storeId, 'storeId');
  if (value.marketplace !== 'US' || value.currency !== 'USD') {
    throw new TypeError('canonical keyword identity must use US/USD');
  }
  requiredId(value.adsAccountId, 'adsAccountId');
  requiredId(value.campaignId, 'campaignId');
  requiredId(value.adGroupId, 'adGroupId');
  requiredId(value.keywordId, 'keywordId');
  positiveInteger(value.objectRevision, 'objectRevision');
}

export function assertOpaqueExecutionArtifactRef(value: unknown): string {
  const normalized = requiredId(value, 'artifactRef');
  if (/^[a-zA-Z]:/.test(normalized)
    || normalized.startsWith('\\\\')
    || /[\\/]/.test(normalized)
    || /^(?:file|https?):/i.test(normalized)
    || normalized.includes('?')
    || normalized.includes('#')) {
    throw new TypeError('artifactRef must be an opaque logical id');
  }
  return normalized;
}

function requiredId(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f]/.test(normalized)) {
    throw new TypeError(`${field} must be a non-empty identifier`);
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${field} must be a positive integer`);
  }
  return normalized;
}
