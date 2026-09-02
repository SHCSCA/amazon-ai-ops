import type { MissionGrantRecord } from './mission-domain';
import type {
  StoreContextEnvelope,
  StoreId,
  UsCurrency,
  UsMarketplace,
} from './store';

/**
 * Durable Stage 5 analysis contracts.
 *
 * These records are safe for Renderer projection. They intentionally contain
 * only opaque hashes and source-row coordinates; local report paths, browser
 * profile paths, cookies, credentials, and screenshot paths stay Main-only.
 */

export const ANALYSIS_REQUIRED_REPORT_TYPES = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
] as const;

export type AnalysisRequiredReportType = (typeof ANALYSIS_REQUIRED_REPORT_TYPES)[number];

export interface AnalysisEvidenceSourceRef {
  reportType: AnalysisRequiredReportType;
  fileHash: string;
  fileSizeBytes: number;
  importedRows: number;
  metricRows: number;
  firstSourceRow?: number;
  lastSourceRow?: number;
}

export interface AnalysisEvidencePackageRecord {
  id: string;
  storeId: StoreId;
  marketplace: UsMarketplace;
  currency: UsCurrency;
  missionId: string;
  dataBatchId: string;
  importRunId: string;
  dateFrom: string;
  dateTo: string;
  asin?: string;
  reportTypes: readonly AnalysisRequiredReportType[];
  sources: readonly AnalysisEvidenceSourceRef[];
  metricRowCount: number;
  reconciliationHash: string;
  ruleRevision: string;
  modelRevision: string;
  packageHash: string;
  importedAt: string;
  freshUntil: string;
  sealedAt: string;
  createdSessionGeneration: number;
}

export interface SealAnalysisEvidencePackageInput {
  missionId: string;
  dateFrom: string;
  dateTo: string;
  asin?: string;
  freshnessWindowHours: number;
  ruleRevision: string;
  modelRevision: string;
}

export type VerifiedAdEntityType = 'keyword' | 'auto_targeting' | 'product_targeting';
export type VerifiedAdEntityIdentitySource = 'ads_ui' | 'ads_api';

/** Append-only proof that one opaque Ads id belongs to the active store. */
export interface VerifiedAdEntityAuthorityRecord {
  authorityId: string;
  storeId: StoreId;
  adEntityId: string;
  entityRevision: number;
  entityType: VerifiedAdEntityType;
  entityName: string;
  campaignName: string;
  adGroupName: string;
  evidencePackageId: string;
  sourceReportType: Extract<AnalysisRequiredReportType, VerifiedAdEntityType>;
  sourceFileHash: string;
  sourceRow: number;
  identitySource: VerifiedAdEntityIdentitySource;
  proofSha256: string;
  verifiedBy: string;
  verifiedAt: string;
  createdAt: string;
}

export interface RegisterVerifiedAdEntityAuthorityInput {
  authorityId: string;
  evidencePackageId: string;
  adEntityId: string;
  entityType: VerifiedAdEntityType;
  entityName: string;
  campaignName: string;
  adGroupName: string;
  sourceReportType: Extract<AnalysisRequiredReportType, VerifiedAdEntityType>;
  sourceFileHash: string;
  sourceRow: number;
  identitySource: VerifiedAdEntityIdentitySource;
  proofSha256: string;
  verifiedBy: string;
  verifiedAt: string;
}

export type AnalysisProposalSource = 'rule' | 'rule_ai' | 'ai' | 'rule_fallback';

export type AnalysisProposalBlockerCode =
  | 'UNSUPPORTED_ACTION'
  | 'MISSING_STABLE_AD_ENTITY'
  | 'STALE_AD_ENTITY_REVISION'
  | 'EVIDENCE_STALE'
  | 'EVIDENCE_BATCH_MISMATCH'
  | 'RULE_REVISION_MISMATCH'
  | 'POLICY_REVISION_MISMATCH'
  | 'AI_RULE_CONFLICT'
  | 'REVIEW_REQUIRED'
  | 'RULE_FALLBACK_NOT_AUTHORIZABLE'
  | 'AI_ONLY_NOT_POLICY_AUTHORIZABLE'
  | 'POLICY_REQUIRES_RULE_AI_ALIGNMENT'
  | 'CHANGE_LIMIT_EXCEEDED'
  | 'POLICY_ENTITY_NOT_ALLOWED'
  | 'POLICY_ACTION_NOT_ALLOWED'
  | 'POLICY_RUNTIME_BLOCKED';

/** Authorization-time codes. Proposal eligibility codes are reused; extras are grant/batch gates. */
export type AnalysisAuthorizationBlockerCode =
  | AnalysisProposalBlockerCode
  | 'AUTONOMY_MODE_CHANGED'
  | 'MISSION_NOT_FOUND'
  | 'MISSION_NOT_ACTIVE'
  | 'PROPOSAL_NOT_FOUND'
  | 'BATCH_MISMATCH'
  | 'STALE_ACTION_BATCH'
  | 'STALE_MISSION_REVISION'
  | 'MODEL_REVISION_MISMATCH'
  | 'INCOMPLETE_BATCH'
  | 'MISSING_DECISION_LINK'
  | 'PROPOSAL_EXPIRED'
  | 'DUPLICATE_AD_ENTITY'
  | 'DECISION_NOT_FOUND'
  | 'DECISION_NOT_AUTHORIZABLE'
  | 'GRANT_TERMINAL'
  | 'GRANT_EXPIRED'
  | 'POLICY_RATE_LIMITS_INVALID'
  | 'POLICY_TIMEZONE_MISMATCH'
  | 'OUTSIDE_EXECUTION_WINDOW'
  | 'DAILY_ACTION_LIMIT_EXCEEDED'
  | 'COOLDOWN_ACTIVE'
  | 'ANALYSIS_INTERRUPTED';

export interface AnalysisAuthorizationBlocker {
  code: AnalysisAuthorizationBlockerCode;
  /** Chinese translation only. Machine code in `code` is the authority. */
  message: string;
}

export const ANALYSIS_RUN_STATUSES = ['running', 'done', 'retryable'] as const;
export type AnalysisRunStatus = (typeof ANALYSIS_RUN_STATUSES)[number];

export interface MissionAnalysisRunProjection {
  status: AnalysisRunStatus;
  missionId: string;
  evidencePackageId?: string;
  blockerCodes?: readonly AnalysisAuthorizationBlockerCode[];
}

export interface AnalysisAuthorizationEligibility {
  eligible: boolean;
  blockers: readonly AnalysisProposalBlockerCode[];
}

export interface AnalysisProposalAuthorization {
  human: AnalysisAuthorizationEligibility;
  policy: AnalysisAuthorizationEligibility;
}

export interface AnalysisActionBatchRecord {
  id: string;
  storeId: StoreId;
  missionId: string;
  missionRevision: number;
  evidencePackageId: string;
  ruleRevision: string;
  modelRevision: string;
  actionRevision: number;
  createdAt: string;
  createdSessionGeneration: number;
}

/** Immutable action proposal snapshot produced from one real recommendation. */
export interface AnalysisProposalSnapshotRecord {
  id: string;
  storeId: StoreId;
  marketplace: UsMarketplace;
  currency: UsCurrency;
  missionId: string;
  missionRevision: number;
  evidencePackageId: string;
  evidencePackageHash: string;
  dataBatchId: string;
  policyVersionId: string;
  policyRevision: number;
  ruleRevision: string;
  modelRevision: string;
  actionBatchId: string;
  actionRevision: number;
  legacyRecommendationId: number;
  actionType: 'set_keyword_bid';
  entityType: 'keyword';
  entityName: string;
  campaignName: string;
  adGroupName: string;
  adEntityAuthorityId?: string;
  adEntityId?: string;
  adEntityRevision?: number;
  currentBidCents: number;
  proposedBidCents: number;
  changePct: number;
  confidence: number;
  source: AnalysisProposalSource;
  explanation: string;
  authorization: AnalysisProposalAuthorization;
  validUntil: string;
  createdAt: string;
  createdSessionGeneration: number;
}

export interface CreateAnalysisProposalSnapshotInput {
  id: string;
  missionId: string;
  evidencePackageId: string;
  legacyRecommendationId: number;
  actionBatchId: string;
  validUntil: string;
  adEntityAuthorityId?: string;
}

export interface AnalysisProposalDecisionLinkRecord {
  id: string;
  storeId: StoreId;
  proposalId: string;
  decisionId: string;
  createdAt: string;
}

export interface RunMissionAnalysisRequest {
  context: StoreContextEnvelope;
  missionId: string;
  /** Optional assertion only. Main derives the authoritative range from Mission.dataBatchId. */
  dateFrom?: string;
  /** Optional assertion only. Main derives the authoritative range from Mission.dataBatchId. */
  dateTo?: string;
}

export interface RunMissionAnalysisResult {
  evidencePackage: AnalysisEvidencePackageRecord;
  proposals: readonly AnalysisProposalSnapshotRecord[];
  generatedRecommendations: number;
  skippedUnsupportedRecommendations: number;
  /** Present only when policy-auto attempted the exact latest batch immediately. */
  automaticAuthorization?: AuthorizeAnalysisProposalBatchResult;
  analysisRun: MissionAnalysisRunProjection;
  ai: {
    configured: boolean;
    invoked: boolean;
    modelRevision: string;
    source: 'ai' | 'rule_fallback';
    detail: string;
  };
}

export interface MissionAnalysisProjection {
  evidencePackages: AnalysisEvidencePackageRecord[];
  actionBatches: AnalysisActionBatchRecord[];
  proposals: AnalysisProposalSnapshotRecord[];
  decisionLinks: AnalysisProposalDecisionLinkRecord[];
  analysisRun?: MissionAnalysisRunProjection;
}

export interface AuthorizeAnalysisProposalBatchRequest {
  context: StoreContextEnvelope;
  missionId: string;
  proposalIds: readonly string[];
}

export interface AuthorizeAnalysisProposalBatchResult {
  mode: 'manual_approval' | 'policy_auto';
  grant?: MissionGrantRecord;
  decisionIds: readonly string[];
  proposalIds: readonly string[];
  authorized: boolean;
  blockers: readonly AnalysisAuthorizationBlocker[];
}

export function validateAnalysisEvidencePackage(
  value: AnalysisEvidencePackageRecord,
): void {
  requiredText(value.id, 'evidencePackage.id');
  requiredText(value.storeId, 'evidencePackage.storeId');
  requiredText(value.missionId, 'evidencePackage.missionId');
  requiredText(value.dataBatchId, 'evidencePackage.dataBatchId');
  requiredText(value.importRunId, 'evidencePackage.importRunId');
  requiredDate(value.dateFrom, 'evidencePackage.dateFrom');
  requiredDate(value.dateTo, 'evidencePackage.dateTo');
  if (value.dateFrom > value.dateTo) throw new TypeError('Evidence package date range is inverted.');
  if (value.marketplace !== 'US' || value.currency !== 'USD') {
    throw new TypeError('Analysis evidence is limited to US marketplace and USD.');
  }
  validateRequiredReportCoverage(value.reportTypes, value.sources);
  nonNegativeInteger(value.metricRowCount, 'evidencePackage.metricRowCount');
  sha256(value.reconciliationHash, 'evidencePackage.reconciliationHash');
  sha256(value.ruleRevision, 'evidencePackage.ruleRevision');
  sha256(value.packageHash, 'evidencePackage.packageHash');
  requiredText(value.modelRevision, 'evidencePackage.modelRevision');
  requiredTimestamp(value.importedAt, 'evidencePackage.importedAt');
  requiredTimestamp(value.freshUntil, 'evidencePackage.freshUntil');
  requiredTimestamp(value.sealedAt, 'evidencePackage.sealedAt');
  if (Date.parse(value.freshUntil) <= Date.parse(value.importedAt)) {
    throw new TypeError('Evidence package freshness window must end after import completion.');
  }
  nonNegativeInteger(value.createdSessionGeneration, 'evidencePackage.createdSessionGeneration');
}

export function validateVerifiedAdEntityAuthority(
  value: VerifiedAdEntityAuthorityRecord,
): void {
  requiredText(value.authorityId, 'adEntityAuthority.authorityId');
  requiredText(value.storeId, 'adEntityAuthority.storeId');
  requiredText(value.adEntityId, 'adEntityAuthority.adEntityId');
  positiveInteger(value.entityRevision, 'adEntityAuthority.entityRevision');
  if (!['keyword', 'auto_targeting', 'product_targeting'].includes(value.entityType)) {
    throw new TypeError('Unsupported verified Ads entity type.');
  }
  requiredText(value.entityName, 'adEntityAuthority.entityName');
  requiredText(value.campaignName, 'adEntityAuthority.campaignName');
  requiredText(value.adGroupName, 'adEntityAuthority.adGroupName');
  requiredText(value.evidencePackageId, 'adEntityAuthority.evidencePackageId');
  if (value.sourceReportType !== value.entityType) {
    throw new TypeError('Verified Ads entity source report must match its entity type.');
  }
  sha256(value.sourceFileHash, 'adEntityAuthority.sourceFileHash');
  positiveInteger(value.sourceRow, 'adEntityAuthority.sourceRow');
  if (!['ads_ui', 'ads_api'].includes(value.identitySource)) {
    throw new TypeError('Unsupported Ads identity source.');
  }
  sha256(value.proofSha256, 'adEntityAuthority.proofSha256');
  requiredText(value.verifiedBy, 'adEntityAuthority.verifiedBy');
  requiredTimestamp(value.verifiedAt, 'adEntityAuthority.verifiedAt');
  requiredTimestamp(value.createdAt, 'adEntityAuthority.createdAt');
}

export function validateAnalysisProposalSnapshot(
  value: AnalysisProposalSnapshotRecord,
): void {
  requiredText(value.id, 'proposal.id');
  requiredText(value.storeId, 'proposal.storeId');
  requiredText(value.missionId, 'proposal.missionId');
  positiveInteger(value.missionRevision, 'proposal.missionRevision');
  requiredText(value.evidencePackageId, 'proposal.evidencePackageId');
  sha256(value.evidencePackageHash, 'proposal.evidencePackageHash');
  requiredText(value.dataBatchId, 'proposal.dataBatchId');
  requiredText(value.policyVersionId, 'proposal.policyVersionId');
  positiveInteger(value.policyRevision, 'proposal.policyRevision');
  sha256(value.ruleRevision, 'proposal.ruleRevision');
  requiredText(value.modelRevision, 'proposal.modelRevision');
  requiredText(value.actionBatchId, 'proposal.actionBatchId');
  positiveInteger(value.actionRevision, 'proposal.actionRevision');
  positiveInteger(value.legacyRecommendationId, 'proposal.legacyRecommendationId');
  if (value.marketplace !== 'US' || value.currency !== 'USD'
    || value.actionType !== 'set_keyword_bid' || value.entityType !== 'keyword') {
    throw new TypeError('Stage 5 proposals support US/USD keyword bid changes only.');
  }
  requiredText(value.entityName, 'proposal.entityName');
  requiredText(value.campaignName, 'proposal.campaignName');
  requiredText(value.adGroupName, 'proposal.adGroupName');
  if (value.adEntityAuthorityId || value.adEntityId || value.adEntityRevision !== undefined) {
    requiredText(value.adEntityAuthorityId, 'proposal.adEntityAuthorityId');
    requiredText(value.adEntityId, 'proposal.adEntityId');
    positiveInteger(value.adEntityRevision, 'proposal.adEntityRevision');
  }
  positiveInteger(value.currentBidCents, 'proposal.currentBidCents');
  positiveInteger(value.proposedBidCents, 'proposal.proposedBidCents');
  finiteNumber(value.changePct, 'proposal.changePct');
  if (value.changePct >= 0) throw new TypeError('A V1 lower-bid proposal must have a negative changePct.');
  finiteNumber(value.confidence, 'proposal.confidence');
  if (value.confidence < 0 || value.confidence > 1) throw new TypeError('Proposal confidence must be within 0..1.');
  if (!['rule', 'rule_ai', 'ai', 'rule_fallback'].includes(value.source)) {
    throw new TypeError('Unsupported proposal source.');
  }
  requiredText(value.explanation, 'proposal.explanation');
  validateEligibility(value.authorization.human, 'proposal.authorization.human');
  validateEligibility(value.authorization.policy, 'proposal.authorization.policy');
  requiredTimestamp(value.validUntil, 'proposal.validUntil');
  requiredTimestamp(value.createdAt, 'proposal.createdAt');
  nonNegativeInteger(value.createdSessionGeneration, 'proposal.createdSessionGeneration');
}

function validateRequiredReportCoverage(
  reportTypes: readonly AnalysisRequiredReportType[],
  sources: readonly AnalysisEvidenceSourceRef[],
): void {
  if (!Array.isArray(reportTypes) || !Array.isArray(sources)) {
    throw new TypeError('Evidence package report coverage must be arrays.');
  }
  const reports = new Set(reportTypes);
  const sourceReports = new Set(sources.map((source) => source.reportType));
  if (reports.size !== ANALYSIS_REQUIRED_REPORT_TYPES.length
    || sourceReports.size !== ANALYSIS_REQUIRED_REPORT_TYPES.length
    || ANALYSIS_REQUIRED_REPORT_TYPES.some((report) => !reports.has(report) || !sourceReports.has(report))) {
    throw new TypeError('Evidence package must retain exactly the eight required Lingxing report types.');
  }
  for (const source of sources) {
    sha256(source.fileHash, `evidencePackage.sources.${source.reportType}.fileHash`);
    nonNegativeInteger(source.fileSizeBytes, `evidencePackage.sources.${source.reportType}.fileSizeBytes`);
    nonNegativeInteger(source.importedRows, `evidencePackage.sources.${source.reportType}.importedRows`);
    nonNegativeInteger(source.metricRows, `evidencePackage.sources.${source.reportType}.metricRows`);
    if (source.firstSourceRow !== undefined) positiveInteger(source.firstSourceRow, 'source.firstSourceRow');
    if (source.lastSourceRow !== undefined) positiveInteger(source.lastSourceRow, 'source.lastSourceRow');
    if (source.firstSourceRow !== undefined && source.lastSourceRow !== undefined
      && source.firstSourceRow > source.lastSourceRow) {
      throw new TypeError('Evidence source row range is inverted.');
    }
  }
}

function validateEligibility(value: AnalysisAuthorizationEligibility, field: string): void {
  if (!value || typeof value !== 'object' || !Array.isArray(value.blockers)) {
    throw new TypeError(`${field} must be a structured eligibility result.`);
  }
  const blockers = new Set(value.blockers);
  if (blockers.size !== value.blockers.length) throw new TypeError(`${field} blockers must be unique.`);
  if (value.eligible !== (value.blockers.length === 0)) {
    throw new TypeError(`${field}.eligible must match its blocker set.`);
  }
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} is required.`);
  return normalized;
}

function requiredDate(value: unknown, field: string): void {
  const normalized = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`))) {
    throw new TypeError(`${field} must be YYYY-MM-DD.`);
  }
}

function requiredTimestamp(value: unknown, field: string): void {
  const normalized = requiredText(value, field);
  if (Number.isNaN(Date.parse(normalized))) throw new TypeError(`${field} must be an ISO timestamp.`);
}

function sha256(value: unknown, field: string): void {
  if (!/^[a-f0-9]{64}$/i.test(requiredText(value, field))) {
    throw new TypeError(`${field} must be a SHA-256 digest.`);
  }
}

function finiteNumber(value: unknown, field: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw new TypeError(`${field} must be finite.`);
  return normalized;
}

function nonNegativeInteger(value: unknown, field: string): void {
  const normalized = finiteNumber(value, field);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new TypeError(`${field} must be a non-negative integer.`);
}

function positiveInteger(value: unknown, field: string): void {
  const normalized = finiteNumber(value, field);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) throw new TypeError(`${field} must be a positive integer.`);
}
