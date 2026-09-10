/**
 * Experiment Domain Model
 *
 * Represents a business experiment - a controlled test of a strategy change.
 * Experiments have a baseline, observation window, guardrails, and produce
 * system-generated conclusions.
 *
 * @module experiment-domain
 */

import type { MissionStage } from './v16-mission-domain';

/**
 * Experiment lifecycle
 */
export type ExperimentStatus =
  | 'draft'        // Created but not started
  | 'running'      // Currently observing
  | 'paused'       // Suspended, can resume
  | 'blocked'      // Guardrail triggered, observation stopped
  | 'completed'    // Observation window ended, conclusion generated
  | 'archived';   // Archived, no longer active

/**
 * Experiment hypothesis
 */
export interface ExperimentHypothesis {
  readonly statement: string;
  readonly expectedEffect: string;
  readonly expectedChangePercent?: number;
  readonly confidenceLevel?: number; // 0-1
}

/**
 * Snapshot recorded during experiment
 */
export interface ExperimentSnapshot {
  readonly snapshotId: string;
  readonly experimentId: string;
  readonly timestamp: string;
  readonly snapshotType: 'baseline' | 'observation' | 'result';
  readonly data: ExperimentMetrics;
  readonly dataSource: string;      // Formal business data source
  readonly proofHash: string;       // SHA-256 of data
}

/**
 * Experiment metrics
 */
export interface ExperimentMetrics {
  readonly impressions?: number;
  readonly clicks?: number;
  readonly spend?: number;
  readonly sales?: number;
  readonly orders?: number;
  readonly acos?: number;
  readonly roas?: number;
  readonly conversionRate?: number;
  readonly customMetrics?: Record<string, number>;
}

/**
 * Guardrail - safety threshold
 */
export interface Guardrail {
  readonly guardrailId: string;
  readonly name: string;
  readonly metric: string;         // e.g., 'spend', 'acos'
  readonly operator: 'gt' | 'lt' | 'gte' | 'lte';
  readonly threshold: number;
  readonly action: 'pause' | 'block' | 'alert';
}

/**
 * System conclusion
 */
export interface ExperimentConclusion {
  readonly conclusionId: string;
  readonly conclusionType: 'success' | 'failure' | 'inconclusive';
  readonly summary: string;
  readonly actualEffect?: string;
  readonly actualChangePercent?: number;
  readonly confidenceLevel?: number;
  readonly supportingData: ExperimentSnapshot[];
  readonly guardrailsTriggered: string[]; // guardrail IDs
}

/**
 * Experiment record schema
 */
export interface ExperimentRecord {
  readonly experimentId: string;
  readonly storeId: string;
  readonly missionId?: string;
  readonly decisionId?: string;

  // Identity
  readonly name: string;
  readonly description?: string;
  readonly hypothesis: ExperimentHypothesis;

  // Scope
  readonly productIds: string[];
  readonly entityIds: string[];          // Specific ad objects being tested

  // Baseline and observation
  readonly baselineSnapshotId?: string;
  readonly observationWindowStart?: string;
  readonly observationWindowEnd?: string;
  readonly observationSnapshots: string[]; // Snapshot IDs

  // Guardrails
  readonly guardrails: Guardrail[];

  // Lifecycle
  readonly status: ExperimentStatus;
  readonly revision: number;

  // Results
  readonly conclusionId?: string;
  readonly guardrailsTriggered: string[];

  // Timestamps
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;

  // Metadata
  readonly metadata?: Record<string, unknown>;
}

/**
 * Status labels
 */
export const EXPERIMENT_STATUS_LABELS: Record<ExperimentStatus, string> = {
  draft: '草稿',
  running: '观察中',
  paused: '已暂停',
  blocked: '已阻断',
  completed: '已完成',
  archived: '已归档',
};

/**
 * Conclusion labels
 */
export const CONCLUSION_LABELS: Record<ExperimentConclusion['conclusionType'], string> = {
  success: '实验成功',
  failure: '实验失败',
  inconclusive: '结果不明确',
};

/**
 * Check if a guardrail is triggered
 */
export function isGuardrailTriggered(
  guardrail: Guardrail,
  metrics: ExperimentMetrics
): boolean {
  const value = (metrics as Record<string, unknown>)[guardrail.metric];
  if (typeof value !== 'number') return false;

  switch (guardrail.operator) {
    case 'gt': return value > guardrail.threshold;
    case 'lt': return value < guardrail.threshold;
    case 'gte': return value >= guardrail.threshold;
    case 'lte': return value <= guardrail.threshold;
    default: return false;
  }
}

/**
 * Check if any guardrail is triggered in a set of metrics
 */
export function checkGuardrails(
  guardrails: Guardrail[],
  metrics: ExperimentMetrics
): Guardrail[] {
  return guardrails.filter(g => isGuardrailTriggered(g, metrics));
}

/**
 * Validate experiment record
 */
export function validateExperimentRecord(record: ExperimentRecord): void {
  if (!record.experimentId || record.experimentId.trim() === '') {
    throw new Error('Experiment ID is required');
  }
  if (!record.storeId || record.storeId.trim() === '') {
    throw new Error('Store ID is required');
  }
  if (!record.name || record.name.trim() === '') {
    throw new Error('Name is required');
  }
  if (!record.hypothesis) {
    throw new Error('Hypothesis is required');
  }
  if (!record.hypothesis.statement || record.hypothesis.statement.trim() === '') {
    throw new Error('Hypothesis statement is required');
  }
  if (!Array.isArray(record.productIds)) {
    throw new Error('Product IDs must be an array');
  }
  if (!Array.isArray(record.entityIds)) {
    throw new Error('Entity IDs must be an array');
  }
  if (!Array.isArray(record.guardrails)) {
    throw new Error('Guardrails must be an array');
  }
  if (!record.status) {
    throw new Error('Status is required');
  }
  if (!record.createdAt) {
    throw new Error('Created timestamp is required');
  }
  if (!record.updatedAt) {
    throw new Error('Updated timestamp is required');
  }

  // Validate timestamps
  const created = new Date(record.createdAt).getTime();
  const updated = new Date(record.updatedAt).getTime();
  if (isNaN(created) || isNaN(updated)) {
    throw new Error('Invalid timestamp format');
  }
  if (updated < created) {
    throw new Error('Updated timestamp cannot be before created timestamp');
  }
}

/**
 * Validate experiment snapshot
 */
export function validateExperimentSnapshot(snapshot: ExperimentSnapshot): void {
  if (!snapshot.snapshotId || snapshot.snapshotId.trim() === '') {
    throw new Error('Snapshot ID is required');
  }
  if (!snapshot.experimentId || snapshot.experimentId.trim() === '') {
    throw new Error('Experiment ID is required');
  }
  if (!snapshot.timestamp) {
    throw new Error('Timestamp is required');
  }
  if (!snapshot.data) {
    throw new Error('Data is required');
  }
  if (!snapshot.dataSource || snapshot.dataSource.trim() === '') {
    throw new Error('Data source is required');
  }
  if (!snapshot.proofHash || snapshot.proofHash.trim() === '') {
    throw new Error('Proof hash is required');
  }

  const timestamp = new Date(snapshot.timestamp).getTime();
  if (isNaN(timestamp)) {
    throw new Error('Invalid timestamp format');
  }
}

/**
 * Build experiment record
 */
export function buildExperimentRecord(params: {
  experimentId: string;
  storeId: string;
  name: string;
  description?: string;
  hypothesis: ExperimentHypothesis;
  productIds: string[];
  entityIds: string[];
  guardrails?: Guardrail[];
  missionId?: string;
  decisionId?: string;
}): ExperimentRecord {
  const now = new Date().toISOString();
  return {
    experimentId: params.experimentId,
    storeId: params.storeId,
    missionId: params.missionId,
    decisionId: params.decisionId,
    name: params.name,
    description: params.description,
    hypothesis: params.hypothesis,
    productIds: params.productIds,
    entityIds: params.entityIds,
    observationSnapshots: [],
    guardrails: params.guardrails || [],
    status: 'draft',
    revision: 1,
    guardrailsTriggered: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build experiment snapshot
 */
export function buildExperimentSnapshot(params: {
  snapshotId: string;
  experimentId: string;
  snapshotType: 'baseline' | 'observation' | 'result';
  data: ExperimentMetrics;
  dataSource: string;
  proofHash: string;
}): ExperimentSnapshot {
  const now = new Date().toISOString();
  return {
    snapshotId: params.snapshotId,
    experimentId: params.experimentId,
    timestamp: now,
    snapshotType: params.snapshotType,
    data: params.data,
    dataSource: params.dataSource,
    proofHash: params.proofHash,
  };
}

/**
 * Check if experiment is terminal
 */
export function isExperimentTerminal(status: ExperimentStatus): boolean {
  return ['completed', 'archived'].includes(status);
}

/**
 * Calculate percent change between baseline and observation
 */
export function calculatePercentChange(baseline: number, observed: number): number {
  if (baseline === 0) return 0;
  return ((observed - baseline) / baseline) * 100;
}
