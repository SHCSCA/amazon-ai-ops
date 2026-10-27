/** 只投影已读取的执行结果和七项证据条件；不读取原件、不授权或写入。 */

import type {
  AdExecutionBatchProjection,
  AdExecutionEvidenceRecord,
  AdExecutionJobProjection,
} from '@amazon-ai-ops/shared-types';

export interface ExecutionGateResult {
  resultVerified: boolean;
  authorityBound: boolean;
  identityVerified: boolean;
  beforeAttached: boolean;
  afterAttached: boolean;
  reloadAttached: boolean;
  distinctEvidence: boolean;
  valuesMatch: boolean;
  /** 当前中文阻断原因。 */
  blockers: string[];
  /** 本机成功结论及全部证据条件同时满足。 */
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
      resultVerified: false,
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
  const resultVerified = batch.status === 'succeeded' && jobs.length > 0 && jobs.every(job => job.status === 'succeeded');
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
  const evidence = selectedJob?.evidence ?? [];
  const slots = evidenceBySlot(evidence, selectedJobId, batch.id);

  // 执行授权必须绑定当前批次和任务。
  const authorityBound = Boolean(grantId) && grantId === batch.grantId && selectedJob?.grantId === batch.grantId;

  // 全批次的标准对象身份均须存在。
  const identityVerified = jobs.length > 0 && jobs.every(
    (job) =>
      Boolean(job.identity?.campaignId) &&
      Boolean(job.identity?.adGroupId) &&
      Boolean(job.identity?.keywordId),
  );

  // 三段证据各自归属当前任务。
  const beforeAttached = Boolean(slots.before);
  const afterAttached = Boolean(slots.after);
  const reloadAttached = Boolean(slots.reload);

  // 三段证据不能复用同一原件。
  const artifactRefs = [slots.before, slots.after, slots.reload]
    .filter(Boolean)
    .map((e) => e!.artifactRef);
  const distinctEvidence = new Set(artifactRefs).size === artifactRefs.length;

  // 保存后与重新载入后的观测值必须完全一致。
  const valuesMatch =
    Boolean(slots.after) &&
    Boolean(slots.reload) &&
    Number.isSafeInteger(slots.after!.observedBidCents) && slots.after!.observedBidCents === slots.reload!.observedBidCents;

  // 未完成核验不能仅凭证据齐全显示成功。
  const blockers: string[] = [];
  if (!resultVerified) blockers.push('执行结果尚未由本机核验，已附加证据不能替代核验结论');
  if (!authorityBound) blockers.push('缺少执行授权绑定');
  if (!identityVerified) blockers.push('广告对象身份尚未全部核验');
  if (!beforeAttached) blockers.push('缺少变更前证据');
  if (!afterAttached) blockers.push('缺少提交后证据');
  if (!reloadAttached) blockers.push('缺少刷新后核验');
  if (!distinctEvidence) blockers.push('证据必须来自不同截图');
  if (!valuesMatch) blockers.push('提交后与刷新后出价不一致');

  const eligible = blockers.length === 0;

  return {
    resultVerified,
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

/** 提供可直接展示的阻断列表。 */
export function executionGateBlockers(
  projection: AdExecutionBatchProjection | null,
  selectedJobId: string | null,
  grantId: string | null,
): string[] {
  return selectExecutionReadbackGate(projection, selectedJobId, grantId).blockers;
}
