import type { BatchRow, EvidenceRow, JobRow } from './contracts';
import type { ExecutionAuthorityRepositoryContext } from './context';
import { referenceConflict } from './values';

export function ensureVerifiedReadbackMemory(
  this: ExecutionAuthorityRepositoryContext,
  batch: BatchRow,
  evidence: readonly EvidenceRow[],
): void {
  if (batch.status !== 'succeeded') return;
  const jobs = this.db.prepare('SELECT * FROM ad_execution_jobs WHERE store_id=? AND batch_id=? ORDER BY ordinal')
    .all(batch.store_id, batch.id) as JobRow[];
  if (!jobs.length || jobs.length > 10 || !batch.terminal_at) throw referenceConflict('Verified readback memory requires a complete succeeded execution batch.');
  for (const job of jobs) {
    if (job.status !== 'succeeded' || job.grant_id !== batch.grant_id || job.mission_id !== batch.mission_id
      || job.created_session_generation !== batch.created_session_generation || !job.submit_intent_id || !job.submitted_at) {
      throw referenceConflict('Verified readback memory job lineage is incomplete.');
    }
    const proofs = evidence.filter(proof => proof.job_id === job.id);
    if (proofs.length !== 3 || new Set(proofs.map(proof => proof.slot)).size !== 3
      || !['before', 'after', 'reload'].every(slot => proofs.some(proof => proof.slot === slot))) {
      throw referenceConflict('Verified readback memory requires all three independent evidence slots.');
    }
    for (const proof of proofs) {
      if (proof.store_id !== batch.store_id || proof.batch_id !== batch.id
        || proof.canonical_keyword_id !== job.canonical_keyword_id || proof.object_revision !== job.object_revision
        || proof.page_identity_hash !== job.page_identity_hash || proof.captured_session_generation !== job.created_session_generation
        || proof.observed_bid_cents !== (proof.slot === 'before' ? job.expected_bid_cents : job.target_bid_cents)
        || !/^[a-f0-9]{64}$/i.test(proof.content_sha256)) {
        throw referenceConflict('Verified readback memory proof does not match the historical execution slot.');
      }
    }
  }
  if (evidence.length !== jobs.length * 3) throw referenceConflict('Verified readback memory includes evidence outside the exact batch.');
  const mission = this.db.prepare('SELECT business_date AS businessDate FROM missions WHERE store_id=? AND id=?')
    .get(batch.store_id, batch.mission_id) as { businessDate: string } | undefined;
  if (!mission) throw referenceConflict('Verified readback memory has no Mission lineage.');
  const id = `causal:execution:${batch.id}:verified-readback`;
  const observedEffect = `已核对本批次 ${jobs.length} 个关键词动作的提交后值和独立刷新回读；该观察仅证明本次写入结果，不表示长期经营效果。`;
  const prior = this.db.prepare('SELECT * FROM causal_events WHERE store_id=? AND id=?').get(batch.store_id, id) as Record<string, unknown> | undefined;
  if (prior) {
    if (prior.stage !== 'READBACK' || prior.event_type !== 'execution_readback_verified'
      || prior.entity_type !== 'ad_execution_batch' || prior.entity_id !== batch.id || prior.mission_id !== batch.mission_id
      || prior.business_date !== mission.businessDate || prior.session_generation !== batch.created_session_generation
      || prior.status !== 'verified' || prior.source !== 'execution-ledger' || prior.observed_effect !== observedEffect) {
      throw referenceConflict('Verified readback memory conflicts with an existing historical record.');
    }
  } else {
    const sequence = (this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM causal_events WHERE store_id=?')
      .get(batch.store_id) as { next: number }).next;
    // 回读事实继承原批次的日期和会话；启动恢复不能套用当前授权或补造截图。
    this.db.prepare(`INSERT INTO causal_events (
      id,store_id,stage,event_type,entity_type,entity_id,mission_id,title,observed_effect,
      status,source,actor_id,business_date,session_generation,sequence,created_at
    ) VALUES (?,?,'READBACK','execution_readback_verified','ad_execution_batch',?,?,?,?,'verified','execution-ledger','execution-authority',?,?,?,?)`)
      .run(id, batch.store_id, batch.id, batch.mission_id, '广告动作独立回读已核验', observedEffect,
        mission.businessDate, batch.created_session_generation, sequence, batch.terminal_at);
  }
  for (const proof of evidence) this.ensureCausalEvidenceRef(batch.store_id, id, proof, batch.terminal_at, id);
}
