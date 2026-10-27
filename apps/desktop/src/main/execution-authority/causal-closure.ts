import { ExecutionAuthorityRepositoryError, MissionDomainRepositoryError } from '@amazon-ai-ops/local-db';
import { type AdExecutionBatchProjection, type AdExecutionJobProjection, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import  {
  EXECUTOR_ACTOR,
  safeReason,
  safeMessage,
  compactId,
} from './values';
import type { ExecutionAuthorityServiceContext } from './context';
export function ensureAuthorizedExecutionLink(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, projection: AdExecutionBatchProjection): void {
    const hasExpectedLink = (): boolean => this.missionRepository.getMissionLineage(context, projection.batch.missionId).links.some((link) => (link.linkType === 'execution'
        && link.targetId === projection.batch.id
        && link.relation === 'authorized_execution_batch'));
    if (hasExpectedLink())
        return;
    try {
        this.missionRepository.appendMissionLink(context, {
            id: compactId('link-execution', [projection.batch.id]),
            missionId: projection.batch.missionId,
            linkType: 'execution',
            targetId: projection.batch.id,
            relation: 'authorized_execution_batch',
            actorId: EXECUTOR_ACTOR,
        });
    }
    catch (error) {
        if (!hasExpectedLink())
            throw error;
    }
}
export function reconcileExecutionMissionLinks(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope): void {
    for (const projection of this.repository.listExecutionBatchesForStoreReconciliation(context)) {
        try {
            this.ensureAuthorizedExecutionLink(context, projection);
        }
        catch (error) {
            this.progress(context, projection.batch.id, undefined, 'terminal', 'blocked', `执行批次 Mission 血缘补全暂未完成：${safeMessage(error)}`);
        }
    }
}
export function markUnknownAndStop(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, batchId: string, job: AdExecutionJobProjection, reasonCode: string, detail: string): AdExecutionBatchProjection {
    const projection = this.repository.terminalizePostIntentUnknownAfterAuthorityLoss(context, {
        jobId: job.id,
        expectedRevision: job.revision,
        reasonCode,
        detail,
    });
    try {
        this.revokeGrantAndStopMission(context, projection, detail, true);
    } catch (error) {
        if (!(error instanceof MissionDomainRepositoryError) || error.code !== 'STALE_CONTEXT') throw error;
        const pending = this.recoveredBatchReconciliations.get(String(context.storeId)) ?? new Set<string>();
        pending.add(batchId);
        this.recoveredBatchReconciliations.set(String(context.storeId), pending);
        this.logger.warn('execution.domain_reconciliation_deferred', { reasonCode: 'SESSION_GENERATION_CHANGED' });
    }
    this.progress(context, batchId, job.id, 'terminal', 'unknown', '保存结果无法证明，已停止 Mission 且禁止自动重试。');
    return projection;
}
export function revokeGrantAndStopMission(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, projection: AdExecutionBatchProjection, reason: string, unknown: boolean): void {
    const grantId = projection.batch.grantId;
    if (!this.missionRepository.getMissionGrantTerminalEvent(context, grantId)) {
        this.missionRepository.appendMissionGrantEvent(context, {
            id: compactId('grant-revoked', [grantId, projection.batch.id]),
            grantId,
            eventType: 'invalidated',
            actorId: EXECUTOR_ACTOR,
            reason: safeReason(reason),
        });
    }
    const mission = this.missionRepository.getMission(context, projection.batch.missionId);
    if (mission && !['completed', 'archived'].includes(mission.status)) {
        if (mission.status !== 'blocked') {
            this.missionRepository.transitionMission(context, {
                id: mission.id,
                expectedRevision: mission.revision,
                status: 'blocked',
                phase: 'action',
                reason: safeReason(reason),
                actorId: EXECUTOR_ACTOR,
            });
        }
        this.appendCheckpointOnce(context, mission.id, projection.batch.id, 'ACTION', unknown ? 'unknown_requires_reconciliation' : 'blocked_before_verified_completion', projection.jobs.reduce((total, job) => total + job.evidence.length, 0));
    }
    try {
        this.repository.completeDomainReconciliation(context, projection.batch.id);
    }
    catch (error) {
        const authorityUnavailable = error instanceof ExecutionAuthorityRepositoryError
            && (error.code === 'INVALID_CONTEXT' || error.code === 'STALE_CONTEXT');
        if (!unknown || !authorityUnavailable)
            throw error;
        const pending = this.recoveredBatchReconciliations.get(String(context.storeId)) ?? new Set<string>();
        pending.add(projection.batch.id);
        this.recoveredBatchReconciliations.set(String(context.storeId), pending);
    }
}
export function finalizeSucceededBatch(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, projection: AdExecutionBatchProjection): void {
    const grantId = projection.batch.grantId;
    const terminal = this.missionRepository.getMissionGrantTerminalEvent(context, grantId);
    if (!terminal) {
        this.missionRepository.appendMissionGrantEvent(context, {
            id: compactId('grant-consumed', [grantId, projection.batch.id]),
            grantId,
            eventType: 'consumed',
            actorId: EXECUTOR_ACTOR,
            reason: 'Every job has after evidence and independent reload verification.',
        });
    }
    for (const job of projection.jobs) {
        let decision = this.missionRepository.getDecision(context, job.decisionId);
        if (decision?.status === 'approved') {
            decision = this.missionRepository.resolveDecision(context, {
                id: decision.id,
                expectedRevision: decision.revision,
                status: 'executed',
                actorId: EXECUTOR_ACTOR,
                reason: `Execution job ${job.id} submitted with durable intent.`,
            });
        }
        if (decision?.status === 'executed') {
            this.missionRepository.resolveDecision(context, {
                id: decision.id,
                expectedRevision: decision.revision,
                status: 'verified',
                actorId: EXECUTOR_ACTOR,
                reason: `Execution job ${job.id} passed after and reload readback.`,
            });
        }
    }
    const evidenceCount = projection.jobs.reduce((total, job) => total + job.evidence.length, 0);
    this.appendCheckpointOnce(context, projection.batch.missionId, projection.batch.id, 'ACTION', 'succeeded', evidenceCount);
    this.appendCheckpointOnce(context, projection.batch.missionId, projection.batch.id, 'READBACK', 'verified', evidenceCount);
    const mission = this.missionRepository.getMission(context, projection.batch.missionId);
    if (mission?.status === 'active' && mission.phase !== 'readback') {
        this.missionRepository.transitionMission(context, {
            id: mission.id,
            expectedRevision: mission.revision,
            status: 'active',
            phase: 'readback',
            reason: 'Execution batch completed with independent reload readback.',
            actorId: EXECUTOR_ACTOR,
        });
    }
    this.repository.completeDomainReconciliation(context, projection.batch.id);
}
export function appendCheckpointOnce(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, missionId: string, batchId: string, stage: 'ACTION' | 'READBACK', status: string, evidenceCount: number): void {
    const id = compactId('execution-checkpoint', [missionId, batchId, stage]);
    const exists = this.missionRepository.listMissionCheckpoints(context, missionId)
        .some((checkpoint) => checkpoint.id === id);
    if (exists)
        return;
    this.missionRepository.appendMissionCheckpoint(context, {
        id,
        missionId,
        stage,
        title: stage === 'ACTION' ? '广告动作执行' : '广告执行回读',
        status,
        evidenceCount,
        actorId: EXECUTOR_ACTOR,
    });
}
export function reconcileRecoveredBatches(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope): void {
    const pending = this.recoveredBatchReconciliations.get(String(context.storeId));
    if (!pending?.size)
        return;
    for (const batchId of [...pending]) {
        try {
            const projection = this.requireBatch(context, batchId);
            if (projection.batch.status === 'succeeded') {
                this.finalizeSucceededBatch(context, projection);
            }
            else {
                this.revokeGrantAndStopMission(context, projection, projection.batch.status === 'unknown'
                    ? '启动恢复发现保存边界后的 UNKNOWN；必须人工对账。'
                    : `启动恢复确认执行批次已 ${projection.batch.status}。`, projection.batch.status === 'unknown');
            }
            pending.delete(batchId);
        }
        catch (error) {
            this.progress(context, batchId, undefined, 'terminal', 'blocked', `启动恢复对账暂未完成：${safeMessage(error)}`);
        }
    }
    if (pending.size === 0)
        this.recoveredBatchReconciliations.delete(String(context.storeId));
}
