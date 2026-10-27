import {
  type StoreCollectionOrchestratorTransitionPhase,
  type StoreCollectionOrchestratorTransitionPurpose,
  type TransitionFieldShape,
} from "./collection-orchestrator-contracts";

export const LEGACY_HISTORY_SCHEMA_VERSION = 4;

export const HISTORY_SCHEMA_VERSION = 5;

export const DEFAULT_POLL_INTERVAL_MS = 30_000;

export const DEFAULT_HISTORY_RETENTION_LIMIT = 500;

export const MAX_HISTORY_PLAINTEXT_BYTES = 1_048_576;

export const MAX_HISTORY_ENVELOPE_BYTES = 4_194_304;

export const STORE_COLLECTION_MAX_DAILY_SEMANTIC_ATTEMPTS_PER_STORE_PROFILE = 32;

export const DIGEST = /^[a-f0-9]{64}$/;

export const SAFE_ID = /^[A-Za-z0-9:_-]{1,160}$/;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const STORE_COLLECTION_TRANSITION_PHASES = [
  'claimed',
  'authority_touch_pending',
  'previous_closed',
  'activated',
  'runtime_started',
  'identity_verified',
  'scheduler_request_bound',
  'scheduler_accepted',
  'scheduler_reconciled',
  'cleanup_pending',
  'completed',
  'blocked',
  'failed',
  'interrupted',
] as const satisfies readonly StoreCollectionOrchestratorTransitionPhase[];

export const TRANSITION_PHASE_FIELD_MATRIX: Record<
  StoreCollectionOrchestratorTransitionPurpose,
  Record<StoreCollectionOrchestratorTransitionPhase, readonly TransitionFieldShape[]>
> = {
  collection: {
    claimed: ['none'],
    authority_touch_pending: ['none'],
    previous_closed: ['none'],
    activated: ['context'],
    runtime_started: ['context'],
    identity_verified: ['context'],
    scheduler_request_bound: ['scheduler'],
    scheduler_accepted: ['scheduler'],
    scheduler_reconciled: ['scheduler'],
    cleanup_pending: ['context', 'scheduler'],
    completed: ['scheduler'],
    blocked: ['context'],
    failed: ['none', 'context', 'scheduler'],
    interrupted: ['none', 'context', 'scheduler'],
  },
  restore: {
    claimed: ['none'],
    authority_touch_pending: ['none'],
    previous_closed: ['none'],
    activated: ['none', 'context'],
    runtime_started: [],
    identity_verified: [],
    scheduler_request_bound: [],
    scheduler_accepted: [],
    scheduler_reconciled: [],
    cleanup_pending: ['none', 'context'],
    completed: ['none', 'context'],
    blocked: [],
    failed: ['none', 'context'],
    interrupted: ['none', 'context'],
  },
};

export const TRANSITION_PHASE_EDGE_MATRIX: Record<
  StoreCollectionOrchestratorTransitionPurpose,
  Record<StoreCollectionOrchestratorTransitionPhase, readonly StoreCollectionOrchestratorTransitionPhase[]>
> = {
  collection: {
    claimed: ['authority_touch_pending', 'failed', 'interrupted'],
    authority_touch_pending: ['previous_closed', 'failed', 'interrupted'],
    previous_closed: ['activated', 'failed', 'interrupted'],
    activated: ['runtime_started', 'cleanup_pending', 'failed', 'interrupted'],
    runtime_started: ['identity_verified', 'cleanup_pending', 'failed', 'interrupted'],
    identity_verified: ['scheduler_request_bound', 'cleanup_pending', 'blocked', 'failed', 'interrupted'],
    scheduler_request_bound: ['scheduler_accepted', 'failed'],
    scheduler_accepted: ['scheduler_reconciled', 'failed'],
    scheduler_reconciled: ['cleanup_pending', 'failed', 'interrupted'],
    cleanup_pending: ['completed', 'blocked', 'failed', 'interrupted'],
    completed: [],
    blocked: [],
    failed: [],
    interrupted: [],
  },
  restore: {
    claimed: ['authority_touch_pending', 'failed', 'interrupted'],
    authority_touch_pending: ['previous_closed', 'failed', 'interrupted'],
    previous_closed: ['activated', 'failed', 'interrupted'],
    activated: ['cleanup_pending', 'failed', 'interrupted'],
    runtime_started: [],
    identity_verified: [],
    scheduler_request_bound: [],
    scheduler_accepted: [],
    scheduler_reconciled: [],
    cleanup_pending: ['completed', 'failed', 'interrupted'],
    completed: [],
    blocked: [],
    failed: [],
    interrupted: [],
  },
};
