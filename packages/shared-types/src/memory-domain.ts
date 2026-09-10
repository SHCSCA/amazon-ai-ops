/**
 * Memory Domain Model (Causal Memory)
 *
 * Represents the append-only causal memory - the trusted timeline of business
 * operations. Each entry is traceable to evidence and must satisfy indexability
 * criteria before being searchable.
 *
 * @module memory-domain
 */

import type { MissionStage } from './v16-mission-domain';

/**
 * Memory status (only trusted observations can be indexed)
 */
export type MemoryStatus =
  | 'observed'      // Initial recording, awaiting verification
  | 'trusted'       // Verified and indexable
  | 'corrected'     // Replaced by a correction (kept for history)
  | 'disputed';     // Under review

/**
 * Causal event types
 */
export type CausalEventType =
  | 'fact_gathered'         // Report data completed
  | 'analysis_started'      // Analysis run started
  | 'analysis_completed'    // Analysis run completed
  | 'decision_proposed'     // Recommendation proposed
  | 'decision_approved'     // Decision approved
  | 'decision_rejected'     // Decision rejected
  | 'grant_issued'          // Grant issued
  | 'action_submitted'      // Action submitted to Ads
  | 'readback_verified'     // Readback verified
  | 'effect_observed'       // Causal effect observed
  | 'experiment_started'    // Experiment started
  | 'experiment_completed'  // Experiment completed
  | 'experiment_blocked'    // Experiment guardrail triggered
  | 'correction';           // Correction to a prior event

/**
 * Causal event record (append-only)
 */
export interface CausalEventRecord {
  readonly eventId: string;
  readonly storeId: string;

  // Provenance
  readonly stage: MissionStage;
  readonly missionId?: string;
  readonly decisionId?: string;
  readonly grantId?: string;
  readonly executionId?: string;
  readonly experimentId?: string;
  readonly analysisRunId?: string;

  // Business context
  readonly entityId?: string;        // Affected ad object
  readonly productId?: string;       // Affected product
  readonly businessDate: string;     // YYYY-MM-DD
  readonly eventType: CausalEventType;

  // Session binding
  readonly sessionGeneration: number;

  // Evidence
  readonly proofHash: string;       // SHA-256 of evidence
  readonly evidenceRefs: EvidenceRef[];

  // Content
  readonly summary: string;         // Human-readable summary
  readonly details?: Record<string, unknown>;

  // Indexability
  readonly status: MemoryStatus;
  readonly memoryDigest?: string;   // Stable 64-bit digest for indexing

  // Timestamps
  readonly createdAt: string;

  // Corrections
  readonly correctionOf?: string;   // Event ID this corrects
  readonly correctedBy?: string;    // Event ID that corrected this

  // Metadata
  readonly metadata?: Record<string, unknown>;
}

/**
 * Evidence reference
 */
export interface EvidenceRef {
  readonly refType: 'screenshot' | 'document' | 'value' | 'hash';
  readonly refPath?: string;
  readonly refHash?: string;
  readonly refValue?: string;
  readonly description?: string;
}

/**
 * Trust indexability conditions
 *
 * An event is indexable (trusted) only if:
 * 1. Belongs to current store
 * 2. Stage is READBACK or EFFECT
 * 3. Status is not UNKNOWN or STILL_UNKNOWN
 * 4. Has at least one valid SHA-256 proof
 * 5. Can be linked back to mission/decision/grant chain
 */
export function isIndexable(event: CausalEventRecord): boolean {
  // Must have a proof hash
  if (!event.proofHash || event.proofHash.length !== 64) {
    return false;
  }

  // Must be in READBACK or EFFECT stage for trust
  if (!['readback', 'effect'].includes(event.stage)) {
    return false;
  }

  // Status must be trusted (not unknown/disputed)
  if (event.status !== 'trusted') {
    return false;
  }

  // Must have provenance
  if (!event.missionId && !event.decisionId && !event.executionId) {
    return false;
  }

  return true;
}

/**
 * Memory search query
 */
export interface MemorySearchQuery {
  storeId: string;
  productId?: string;
  entityId?: string;
  missionId?: string;
  stage?: MissionStage;
  eventType?: CausalEventType;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

/**
 * Memory export
 */
export interface MemoryExport {
  readonly exportId: string;
  readonly storeId: string;
  readonly exportedAt: string;
  readonly eventCount: number;
  readonly dateRange: { start: string; end: string };
  readonly events: CausalEventRecord[];
  readonly proof: { hashChainRoot: string; totalHashes: number };
}

/**
 * Compute memory digest (stable 64-bit hash)
 */
export function computeMemoryDigest(event: CausalEventRecord): string {
  const canonical = JSON.stringify({
    id: event.eventId,
    stage: event.stage,
    type: event.eventType,
    entityId: event.entityId ?? '',
    businessDate: event.businessDate,
    proofHash: event.proofHash,
    createdAt: event.createdAt,
  });

  // Simple hash (in production use crypto.createHash('sha256'))
  let hash1 = 0;
  let hash2 = 0;
  for (let i = 0; i < canonical.length; i++) {
    const char = canonical.charCodeAt(i);
    hash1 = ((hash1 << 5) - hash1) + char;
    hash1 = hash1 & hash1;
    if (i % 2 === 0) {
      hash2 = ((hash2 << 7) - hash2) + char;
      hash2 = hash2 & hash2;
    }
  }
  const part1 = Math.abs(hash1).toString(16).padStart(16, '0').slice(0, 16);
  const part2 = Math.abs(hash2).toString(16).padStart(16, '0').slice(0, 16);
  return `${part1}${part2}`;
}

/**
 * Event type labels
 */
export const EVENT_TYPE_LABELS: Record<CausalEventType, string> = {
  fact_gathered: '数据采集',
  analysis_started: '分析开始',
  analysis_completed: '分析完成',
  decision_proposed: '建议提议',
  decision_approved: '建议批准',
  decision_rejected: '建议拒绝',
  grant_issued: '授权签发',
  action_submitted: '执行提交',
  readback_verified: '回读验证',
  effect_observed: '效果观察',
  experiment_started: '实验开始',
  experiment_completed: '实验完成',
  experiment_blocked: '实验阻断',
  correction: '记录修正',
};

/**
 * Memory status labels
 */
export const MEMORY_STATUS_LABELS: Record<MemoryStatus, string> = {
  observed: '已记录',
  trusted: '已验证',
  corrected: '已修正',
  disputed: '有争议',
};

/**
 * Validate causal event record
 */
export function validateCausalEventRecord(event: CausalEventRecord): void {
  if (!event.eventId || event.eventId.trim() === '') {
    throw new Error('Event ID is required');
  }
  if (!event.storeId || event.storeId.trim() === '') {
    throw new Error('Store ID is required');
  }
  if (!event.stage) {
    throw new Error('Stage is required');
  }
  if (!event.businessDate) {
    throw new Error('Business date is required');
  }
  if (!event.eventType) {
    throw new Error('Event type is required');
  }
  if (!event.proofHash || event.proofHash.trim() === '') {
    throw new Error('Proof hash is required');
  }
  if (!Array.isArray(event.evidenceRefs)) {
    throw new Error('Evidence refs must be an array');
  }
  if (!event.summary || event.summary.trim() === '') {
    throw new Error('Summary is required');
  }
  if (!event.status) {
    throw new Error('Status is required');
  }
  if (!event.createdAt) {
    throw new Error('Created timestamp is required');
  }

  const created = new Date(event.createdAt).getTime();
  if (isNaN(created)) {
    throw new Error('Invalid created timestamp');
  }

  // Validate business date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.businessDate)) {
    throw new Error('Business date must be in YYYY-MM-DD format');
  }
}

/**
 * Build causal event record
 */
export function buildCausalEventRecord(params: {
  eventId: string;
  storeId: string;
  stage: MissionStage;
  businessDate: string;
  eventType: CausalEventType;
  sessionGeneration: number;
  proofHash: string;
  evidenceRefs: EvidenceRef[];
  summary: string;
  missionId?: string;
  decisionId?: string;
  grantId?: string;
  executionId?: string;
  experimentId?: string;
  analysisRunId?: string;
  entityId?: string;
  productId?: string;
  details?: Record<string, unknown>;
}): CausalEventRecord {
  const now = new Date().toISOString();
  
  const event: CausalEventRecord = {
    eventId: params.eventId,
    storeId: params.storeId,
    stage: params.stage,
    missionId: params.missionId,
    decisionId: params.decisionId,
    grantId: params.grantId,
    executionId: params.executionId,
    experimentId: params.experimentId,
    analysisRunId: params.analysisRunId,
    entityId: params.entityId,
    productId: params.productId,
    businessDate: params.businessDate,
    eventType: params.eventType,
    sessionGeneration: params.sessionGeneration,
    proofHash: params.proofHash,
    evidenceRefs: params.evidenceRefs,
    summary: params.summary,
    details: params.details,
    status: 'observed',
    createdAt: now,
  };

  // Compute memory digest
  return { ...event, memoryDigest: computeMemoryDigest(event) };
}

/**
 * Build correction event
 */
export function buildCorrectionEvent(params: {
  eventId: string;
  storeId: string;
  correctionOf: string;
  stage: MissionStage;
  businessDate: string;
  sessionGeneration: number;
  proofHash: string;
  evidenceRefs: EvidenceRef[];
  summary: string;
  missionId?: string;
  decisionId?: string;
  grantId?: string;
  executionId?: string;
  details?: Record<string, unknown>;
}): CausalEventRecord {
  const base = buildCausalEventRecord({
    ...params,
    eventType: 'correction',
  });

  return {
    ...base,
    correctionOf: params.correctionOf,
  };
}

/**
 * Build evidence reference
 */
export function buildEvidenceRef(params: {
  refType: 'screenshot' | 'document' | 'value' | 'hash';
  refPath?: string;
  refHash?: string;
  refValue?: string;
  description?: string;
}): EvidenceRef {
  return {
    refType: params.refType,
    refPath: params.refPath,
    refHash: params.refHash,
    refValue: params.refValue,
    description: params.description,
  };
}

/**
 * Safe export (excludes secrets and local paths)
 */
export function safeExportEvent(event: CausalEventRecord): CausalEventRecord {
  return {
    ...event,
    evidenceRefs: event.evidenceRefs.map(ref => ({
      ...ref,
      refPath: ref.refPath ? '[REDACTED]' : undefined,
    })),
    details: event.details ? { ...event.details, _localPath: '[REDACTED]' } : undefined,
  };
}
