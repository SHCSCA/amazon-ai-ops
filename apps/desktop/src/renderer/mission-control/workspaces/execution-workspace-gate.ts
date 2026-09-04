/**
 * execution-workspace-gate.ts
 *
 * Pure selector — no side effects, no IPC, no network. Takes the current
 * execution projection and selected job and returns a structured gate report with
 * a flat `blockers: string[]` array suitable for rendering in a single
 * `role="status"` indicator strip.
 *
 * The 7 gates:
 *  1. authorityBound    — current batch has a grant binding
 *  2. identityVerified — all jobs in the batch have resolved campaign/adgroup/keyword IDs
 *  3. beforeAttached   — "before" evidence slot is populated for the selected job
 *  4. afterAttached    — "after" evidence slot is populated for the selected job
 *  5. reloadAttached   — "reload" evidence slot is populated for the selected job
 *  6. distinctEvidence — the three evidence entries come from different artifact refs
 *  7. valuesMatch      — the saved (after) bid equals the reload bid within 1 cent
 *
 * The selector only reads already-fetched renderer state. It does NOT:
 *   - trigger new IPC calls
 *   - verify SHA-256 hashes
 *   - write anything to SQLite
 */

import type {
  AdExecutionBatchProjection,
  AdExecutionEvidenceRecord,
  AdExecutionJobProjection,
} from '@amazon-ai-ops/shared-types';

export interface ExecutionGateResult {
  authorityBound: boolean;
  identityVerified: boolean;
  beforeAttached: boolean;
  afterAttached: boolean;
  reloadAttached: boolean;
  distinctEvidence: boolean;
  valuesMatch: boolean;
  /** Concise operator-facing blocker messages. Empty when all gates are open. */
  blockers: string[];
  /** True when all 7 gates are open. */
  eligible: boolean;
}

function evidenceBySlot(
  evidence: readonly AdExecutionEvidenceRecord[],
  jobId: string,
  batchId: string,
) {
  return {
    before: evidence.find(
      (e) => e.batchId === batchId && e.jobId === jobId && e.slot === 'before',
    ),
    after: evidence.find(
      (e) => e.batchId === batchId && e.jobId === jobId && e.slot === 'after',
    ),
    reload: evidence.find(
      (e) => e.batchId === batchId && e.jobId === jobId && e.slot === 'reload',
    ),
  };
}

/**
 * Select the readback gate for a given execution projection and job.
 *
 * @param projection  The current `AdExecutionBatchProjection` loaded from the API.
 * @param selectedJobId  The currently-selected job id (from the queue table).
 * @param grantId  The grant id that bound the current batch (passed separately so
 *                 the selector stays decoupled from the grant store).
 */
export function selectExecutionReadbackGate(
  projection: AdExecutionBatchProjection | null,
  selectedJobId: string | null,
  grantId: string | null,
): ExecutionGateResult {
  if (!projection || !selectedJobId) {
    return {
      authorityBound: false,
      identityVerified: false,
      beforeAttached: false,
      afterAttached: false,
      reloadAttached: false,
      distinctEvidence: false,
      valuesMatch: false,
      blockers: ['尚未选择执行批次'],
      eligible: false,
    };
  }

  const { batch, jobs } = projection;
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
  const evidence = selectedJob?.evidence ?? [];
  const slots = evidenceBySlot(evidence, selectedJobId, batch.id);

  // Gate 1: authority bound
  const authorityBound = Boolean(grantId) && Boolean(batch.grantId);

  // Gate 2: identity verified (all jobs in batch must have resolved IDs)
  const identityVerified = jobs.every(
    (job) =>
      Boolean(job.identity?.campaignId) &&
      Boolean(job.identity?.adGroupId) &&
      Boolean(job.identity?.keywordId),
  );

  // Gate 3–5: evidence slots
  const beforeAttached = Boolean(slots.before);
  const afterAttached = Boolean(slots.after);
  const reloadAttached = Boolean(slots.reload);

  // Gate 6: distinct evidence (no duplicate artifact refs across the three slots)
  const artifactRefs = [slots.before, slots.after, slots.reload]
    .filter(Boolean)
    .map((e) => e!.artifactRef);
  const distinctEvidence = new Set(artifactRefs).size === artifactRefs.length;

  // Gate 7: values match (after bid === reload bid within 1 cent)
  const valuesMatch =
    Boolean(slots.after) &&
    Boolean(slots.reload) &&
    Math.abs(slots.after!.observedBidCents - slots.reload!.observedBidCents) <= 1;

  // Build blockers list
  const blockers: string[] = [];
  if (!authorityBound) blockers.push('缺少执行授权绑定');
  if (!identityVerified) blockers.push('广告对象身份尚未全部核验');
  if (!beforeAttached) blockers.push('缺少变更前证据');
  if (!afterAttached) blockers.push('缺少提交后证据');
  if (!reloadAttached) blockers.push('缺少刷新后核验');
  if (!distinctEvidence) blockers.push('证据必须来自不同截图');
  if (!valuesMatch) blockers.push('提交后与刷新后出价不一致');

  const eligible = blockers.length === 0;

  return {
    authorityBound,
    identityVerified,
    beforeAttached,
    afterAttached,
    reloadAttached,
    distinctEvidence,
    valuesMatch,
    blockers,
    eligible,
  };
}

/** Convenience: extracts just the blockers array for quick inline rendering. */
export function executionGateBlockers(
  projection: AdExecutionBatchProjection | null,
  selectedJobId: string | null,
  grantId: string | null,
): string[] {
  return selectExecutionReadbackGate(projection, selectedJobId, grantId).blockers;
}
