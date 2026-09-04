/**
 * Mission Domain Model
 *
 * Represents a mission flight plan - the core unit of work in V1.6.
 * A mission goes through 6 stages: FACT → ANALYSIS → DECISION → ACTION → READBACK → EFFECT
 *
 * @module mission-domain
 */

import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

/**
 * Mission lifecycle stages (六阶段)
 */
export type MissionStage =
  | 'fact'       // Report data gathering (implicit, not persisted)
  | 'analysis'    // AI/rule analysis running
  | 'decision'   // Recommendations generated, awaiting approval
  | 'action'     // Approved actions submitted for execution
  | 'readback'   // Execution verified through UI readback
  | 'effect';    // Outcome observed, causal memory recorded

/**
 * Mission status
 */
export type MissionStatus =
  | 'draft'        // Created but not started
  | 'active'       // Currently running
  | 'paused'       // Suspended, can resume
  | 'blocked'      // Blocked by a gate
  | 'completed'    // Successfully completed (reached EFFECT or operator confirmed)
  | 'archived';   // Archived, no longer active

/**
 * Mission record schema
 */
export interface MissionRecord {
  readonly missionId: string;
  readonly storeId: string;
  readonly marketplace: string;    // Fixed: US
  readonly currency: string;      // Fixed: USD
  readonly businessDate: string;  // YYYY-MM-DD

  // Mission identity
  readonly name: string;
  readonly description?: string;

  // Scope
  readonly productIds: string[];       // Products in scope
  readonly reportSnapshotId?: string;  // 8/8 report snapshot used
  readonly observationWindowStart?: string;  // ISO date
  readonly observationWindowEnd?: string;    // ISO date

  // Policy context
  readonly policyVersionId?: string;
  readonly policyRevision?: string;

  // Context binding (Phase 5: prevent stale context)
  readonly sessionGeneration: number;  // Store session when created
  readonly contextSnapshot: StoreContextEnvelope;  // Full context at creation

  // Lifecycle
  readonly stage: MissionStage;
  readonly status: MissionStatus;
  readonly revision: number;  // Optimistic concurrency

  // Timestamps
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;

  // Audit
  readonly createdBy?: string;
  readonly lastModifiedBy?: string;
  readonly reason?: string;  // For status changes

  // Metadata
  readonly metadata?: Record<string, unknown>;
}

/**
 * Mission creation input
 */
export interface CreateMissionInput {
  storeContext: StoreContextEnvelope;
  name: string;
  description?: string;
  productIds: string[];
  reportSnapshotId?: string;
  observationWindowStart?: string;
  observationWindowEnd?: string;
  policyVersionId?: string;
  reason?: string;
}

/**
 * Mission stage transition
 */
export interface StageTransition {
  readonly from: MissionStage;
  readonly to: MissionStage;
  readonly timestamp: string;
  readonly reason?: string;
  readonly triggeredBy: 'system' | 'operator';
}

/**
 * Valid stage transitions
 */
export const VALID_STAGE_TRANSITIONS: Record<MissionStage, MissionStage[]> = {
  fact: ['analysis'],
  analysis: ['decision', 'blocked'],
  decision: ['action', 'blocked'],
  action: ['readback', 'blocked'],
  readback: ['effect', 'blocked'],
  effect: [], // Terminal stage
};

/**
 * Check if a stage transition is valid
 */
export function isValidStageTransition(from: MissionStage, to: MissionStage): boolean {
  return VALID_STAGE_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Stage labels for display
 */
export const STAGE_LABELS: Record<MissionStage, string> = {
  fact: '数据准备',
  analysis: '分析中',
  decision: '决策中',
  action: '执行中',
  readback: '回读验证',
  effect: '效果观察',
};

/**
 * Status labels for display
 */
export const STATUS_LABELS: Record<MissionStatus, string> = {
  draft: '草稿',
  active: '进行中',
  paused: '已暂停',
  blocked: '已阻断',
  completed: '已完成',
  archived: '已归档',
};

/**
 * Stage completion criteria (what must be true to advance)
 */
export interface StageCompletionCriteria {
  fact: {
    requiredReports: number;  // Must have 8/8 reports
    reportSnapshotId: string;
  };
  analysis: {
    analysisRunId: string;
    completedAt: string;
  };
  decision: {
    approvedCount: number;
    rejectedCount: number;
    pendingCount: number;
  };
  action: {
    submittedCount: number;
    failedCount: number;
  };
  readback: {
    verifiedCount: number;
    unknownCount: number;
  };
  effect: {
    observationWindowEnd: string;
    hasCausalMemory: boolean;
  };
}
