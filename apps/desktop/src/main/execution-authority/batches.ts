import fs from 'node:fs';
import path from 'node:path';
import  {
  KeywordBidAdapter,
  fingerprintKeywordBidPageSnapshot,
  LINGXING_KEYWORD_BID_ORIGIN,
  LINGXING_KEYWORD_BID_PATH,
  PlaywrightLingxingKeywordBidPage,
  type KeywordBidApplyResult,
  type KeywordBidCommand,
} from '@amazon-ai-ops/action-executor';
import { type BrowserLease, type StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import { ExecutionAuthorityRepositoryError, isPolicyExecutionBatchSafelyRestartable } from '@amazon-ai-ops/local-db';
import  {
  type AdExecutionBatchProjection,
  type AdExecutionJobProjection,
  type CreateAdExecutionBatchRequest,
  type CreateAdExecutionBatchResult,
  type CancelAdExecutionBatchRequest,
  type MissionGrantRecord,
  type StartAdExecutionBatchRequest,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { buildExecutionEvidenceInput, executionEvidencePath } from '../execution-artifacts';
import { ExecutionBrowserRuntime, RunningBatch, PreparedJob } from './contracts';
import  {
  EXECUTION_LEASE_TTL_MS,
  canonicalPageUrl,
  requiredId,
  requiredSha256,
  requiredTimestamp,
  safeReason,
  safeMessage,
  compactId,
  releaseLeaseQuietly,
} from './values';
import type { ExecutionAuthorityServiceContext } from './context';
export function listBatches(this: ExecutionAuthorityServiceContext, contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[] {
    const context = this.assertContext(contextInput);
    return [...this.repository.listExecutionBatchesForStoreReconciliation(context)].reverse();
}
export function createBatch(this: ExecutionAuthorityServiceContext, request: CreateAdExecutionBatchRequest): CreateAdExecutionBatchResult {
    this.assertNotStopping();
    const context = this.assertContext(request.context);
    this.requireLiveGrant(context, request.grantId);
    const result = this.repository.createExactExecutionBatch(context, request.grantId);
    this.ensureAuthorizedExecutionLink(context, result.projection);
    this.progress(context, result.projection.batch.id, undefined, 'queue', result.projection.batch.status, result.created ? '已从不可变授权创建完整串行执行批次。' : '已返回现有幂等执行批次。');
    return result;
}
export function startBatch(this: ExecutionAuthorityServiceContext, request: StartAdExecutionBatchRequest): Promise<AdExecutionBatchProjection> {
    return this.withAdmittedBrowserOperation('start-execution-batch', () => this.startBatchAdmitted(request));
}
export async function startBatchAdmitted(this: ExecutionAuthorityServiceContext, request: StartAdExecutionBatchRequest): Promise<AdExecutionBatchProjection> {
    const context = this.assertContext(request.context);
    const batchId = requiredId(request.batchId, 'batchId');
    const active = this.running.get(String(context.storeId));
    if (active) {
        if (active.batchId !== batchId)
            throw new Error('当前店铺已有另一个外部写入批次正在运行。');
        return active.promise;
    }
    const running: RunningBatch = {
        batchId,
        cancelRequested: false,
        promise: Promise.resolve(undefined as never),
    };
    running.promise = this.runBatch(context, batchId, running).finally(() => {
        if (this.running.get(String(context.storeId)) === running) {
            this.running.delete(String(context.storeId));
        }
    });
    this.running.set(String(context.storeId), running);
    return running.promise;
}
export function cancelBatch(this: ExecutionAuthorityServiceContext, request: CancelAdExecutionBatchRequest): AdExecutionBatchProjection {
    const context = this.assertContext(request.context);
    const batchId = requiredId(request.batchId, 'batchId');
    const projection = this.requireBatch(context, batchId);
    if (projection.jobs.some((job) => ['intent_written', 'submitted', 'verifying', 'unknown'].includes(job.status))) {
        throw new Error('批次已经进入保存边界，不能取消；必须等待回读或进行 UNKNOWN 人工对账。');
    }
    const running = this.running.get(String(context.storeId));
    if (running?.batchId === batchId)
        running.cancelRequested = true;
    let current = projection;
    for (const job of current.jobs) {
        if (job.status !== 'queued' && job.status !== 'preflight')
            continue;
        this.repository.cancelJob(context, {
            jobId: job.id,
            expectedRevision: job.revision,
            reasonCode: 'operator_cancelled_before_intent',
            detail: safeReason(request.reason),
        });
        current = this.requireBatch(context, batchId);
    }
    this.revokeGrantAndStopMission(context, current, '批次在保存意图前由操作员取消。', false);
    this.progress(context, batchId, undefined, 'terminal', 'cancelled', '批次已在保存意图前安全取消。');
    return this.requireBatch(context, batchId);
}
export async function runBatch(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, batchId: string, running: RunningBatch): Promise<AdExecutionBatchProjection> {
    let projection = this.requireBatch(context, batchId);
    if (projection.batch.status === 'succeeded') {
        this.finalizeSucceededBatch(context, projection);
        return this.requireBatch(context, batchId);
    }
    if (['blocked', 'unknown', 'cancelled'].includes(projection.batch.status))
        return projection;
    const grant = this.requireLiveGrant(context, projection.batch.grantId);
    const lease = this.leases.acquire({
        storeId: context.storeId,
        purpose: 'external_write',
        owner: `execution:${batchId}`,
        ttlMs: EXECUTION_LEASE_TTL_MS,
    });
    const prepared = new Map<string, PreparedJob>();
    this.progress(context, batchId, undefined, 'queue', projection.batch.status, '完整动作批次开始串行预检。');
    try {
        await this.requireRuntime(context).bringToFront();
        for (const original of projection.jobs) {
            if (original.status === 'succeeded')
                continue;
            if (running.cancelRequested)
                return this.cancelBatch({ context, batchId, reason: '执行前收到取消请求' });
            let job = this.requireJob(context, batchId, original.id);
            if (job.status === 'queued') {
                job = this.repository.startJob(context, {
                    jobId: job.id,
                    expectedRevision: job.revision,
                }).job;
            }
            if (job.status !== 'preflight') {
                throw new Error(`动作 ${job.id} 不是可预检状态。`);
            }
            const runtime = await this.navigateToJob(context, job, lease);
            const command = this.commandFor(context, grant, job, runtime.capsule);
            const adapter = new KeywordBidAdapter(new PlaywrightLingxingKeywordBidPage(runtime.page), { now: this.now });
            const preflight = await adapter.preflight(command);
            if (preflight.status !== 'READY') {
                if (grant.issuer.type === 'policy'
                    && preflight.error.code === 'PREFLIGHT_BLOCKED'
                    && isPolicyExecutionBatchSafelyRestartable(this.requireBatch(context, batchId))) {
                    throw new Error('Visible browser preflight is temporarily unavailable before submit intent.');
                }
                this.repository.markBlocked(context, {
                    jobId: job.id,
                    expectedRevision: job.revision,
                    reasonCode: preflight.error.code,
                    detail: preflight.error.message,
                });
                projection = this.requireBatch(context, batchId);
                this.cancelRemainingBeforeIntent(context, projection, 'batch_preflight_blocked');
                this.revokeGrantAndStopMission(context, projection, preflight.error.message, false);
                this.progress(context, batchId, job.id, 'terminal', 'blocked', preflight.error.message);
                return this.requireBatch(context, batchId);
            }
            job = this.requireJob(context, batchId, job.id);
            if (job.status === 'cancelled')
                return this.requireBatch(context, batchId);
            const actualPageIdentityHash = fingerprintKeywordBidPageSnapshot(preflight.snapshot);
            const recorded = this.repository.recordPreflight(context, {
                jobId: job.id,
                expectedRevision: job.revision,
                observedBidCents: preflight.snapshot.keyword.bidCents,
                pageIdentityHash: actualPageIdentityHash,
                canonicalKeywordId: job.canonicalKeywordId,
                objectRevision: job.identity.objectRevision,
            });
            prepared.set(job.id, { command, preflight, pageIdentityHash: actualPageIdentityHash });
            this.progress(context, batchId, job.id, 'preflight', recorded.job.status, '执行前值、稳定身份与页面身份已复核。');
        }
        for (const original of projection.jobs) {
            if (original.status === 'succeeded')
                continue;
            if (running.cancelRequested)
                return this.cancelBatch({ context, batchId, reason: '保存边界前收到取消请求' });
            let job = this.requireJob(context, batchId, original.id);
            const preparedJob = prepared.get(job.id);
            if (!preparedJob || job.status !== 'preflight') {
                throw new Error(`动作 ${job.id} 缺少当前批次预检。`);
            }
            const runtime = await this.navigateToJob(context, job, lease);
            const adapter = new KeywordBidAdapter(new PlaywrightLingxingKeywordBidPage(runtime.page), { now: this.now });
            let intentJob: AdExecutionJobProjection | undefined;
            let applyResult: KeywordBidApplyResult;
            try {
                applyResult = await adapter.apply(preparedJob.command, preparedJob.preflight, {
                    beforeSubmit: async (intent) => {
                        this.assertContext(context);
                        this.requireLiveGrant(context, grant.id);
                        this.assertLeaseAndRuntime(lease, context, job.identity.adsAccountId);
                        if (running.cancelRequested || this.stopping) {
                            throw new Error('保存意图写入前收到停止请求。');
                        }
                        const before = buildExecutionEvidenceInput({
                            storeId: String(context.storeId),
                            batchId,
                            jobId: job.id,
                            slot: 'before',
                            absolutePath: preparedJob.preflight.beforeEvidence.path,
                            pageIdentityHash: preparedJob.pageIdentityHash,
                            canonicalKeywordId: job.canonicalKeywordId,
                            objectRevision: job.identity.objectRevision,
                            observedBidCents: job.expectedBidCents,
                            capturedAt: preparedJob.preflight.beforeEvidence.capturedAt,
                        });
                        const submitIntentId = compactId('submit-intent', [
                            job.id,
                            job.revision,
                            intent.commandFingerprint,
                        ]);
                        intentJob = this.repository.recordSubmitIntent(context, {
                            jobId: job.id,
                            expectedRevision: job.revision,
                            before,
                            submitIntentId,
                            commandFingerprint: intent.commandFingerprint,
                        }).job;
                        job = intentJob;
                        this.progress(context, batchId, job.id, 'submit', job.status, '保存意图已持久化；下一步只允许单次点击保存。');
                        return {
                            intentId: requiredId(job.submitIntentId, 'submitIntentId'),
                            persistedAt: requiredTimestamp(job.intentWrittenAt, 'intentWrittenAt'),
                            commandFingerprint: requiredSha256(job.commandFingerprint, 'commandFingerprint'),
                        };
                    },
                    afterSubmit: (receipt) => {
                        if (receipt.intentId !== job.submitIntentId)
                            throw new Error('提交回执与当前动作意图不一致。');
                        job = this.repository.recordSubmitted(context, { jobId: job.id, expectedRevision: job.revision }).job;
                    },
                });
            }
            catch (error) {
                if (['intent_written', 'submitted', 'verifying'].includes(job.status)) {
                    const authorityLost = error instanceof ExecutionAuthorityRepositoryError
                        && (error.code === 'INVALID_CONTEXT' || error.code === 'STALE_CONTEXT');
                    return this.markUnknownAndStop(context, batchId, job, authorityLost ? 'ADS_AUTHORITY_LOST_AFTER_INTENT' : 'COORDINATOR_FAILURE_AFTER_INTENT', authorityLost
                        ? 'Ads 会话在保存后失去可信状态，提交结果必须人工核对。'
                        : safeMessage(error));
                }
                job = this.requireJob(context, batchId, job.id);
                this.repository.markBlocked(context, {
                    jobId: job.id,
                    expectedRevision: job.revision,
                    reasonCode: 'COORDINATOR_FAILURE_BEFORE_INTENT',
                    detail: safeMessage(error),
                });
                projection = this.requireBatch(context, batchId);
                this.cancelRemainingBeforeIntent(context, projection, 'batch_apply_blocked');
                this.revokeGrantAndStopMission(context, projection, safeMessage(error), false);
                return this.requireBatch(context, batchId);
            }
            if (applyResult.status !== 'SUBMITTED') {
                if (applyResult.status === 'UNKNOWN' || applyResult.submitAttempted) {
                    if (!['intent_written', 'submitted', 'verifying'].includes(job.status)) {
                        throw new Error('保存结果不确定，但执行账本缺少已持久化的提交意图。');
                    }
                    return this.markUnknownAndStop(context, batchId, job, applyResult.error.code, applyResult.error.message);
                }
                job = this.requireJob(context, batchId, job.id);
                if (job.status === 'cancelled')
                    return this.requireBatch(context, batchId);
                if (grant.issuer.type === 'policy'
                    && applyResult.status === 'NOT_SUBMITTED'
                    && !applyResult.submitAttempted
                    && isPolicyExecutionBatchSafelyRestartable(this.requireBatch(context, batchId))) {
                    throw new Error('Final policy permit is temporarily unavailable before submit intent.');
                }
                if (job.status === 'intent_written') {
                    this.repository.markNotSubmittedAfterIntent(context, {
                        jobId: job.id,
                        expectedRevision: job.revision,
                        reasonCode: applyResult.error.code,
                        detail: applyResult.error.message,
                    });
                    projection = this.requireBatch(context, batchId);
                    this.cancelRemainingBeforeIntent(context, projection, 'batch_apply_blocked');
                    this.revokeGrantAndStopMission(context, projection, applyResult.error.message, false);
                }
                else {
                    this.repository.markBlocked(context, {
                        jobId: job.id,
                        expectedRevision: job.revision,
                        reasonCode: applyResult.error.code,
                        detail: applyResult.error.message,
                    });
                    projection = this.requireBatch(context, batchId);
                    this.cancelRemainingBeforeIntent(context, projection, 'batch_apply_blocked');
                    this.revokeGrantAndStopMission(context, projection, applyResult.error.message, false);
                }
                return this.requireBatch(context, batchId);
            }
            try {
                job = this.requireJob(context, batchId, job.id);
                if (job.status !== 'submitted')
                    throw new Error('保存点击缺少持久化提交回执，必须只读对账。');
                const after = buildExecutionEvidenceInput({
                    storeId: String(context.storeId),
                    batchId,
                    jobId: job.id,
                    slot: 'after',
                    absolutePath: applyResult.afterEvidence.path,
                    pageIdentityHash: fingerprintKeywordBidPageSnapshot(applyResult.afterSnapshot),
                    canonicalKeywordId: job.canonicalKeywordId,
                    objectRevision: job.identity.objectRevision,
                    observedBidCents: applyResult.afterSnapshot.keyword.bidCents,
                    capturedAt: applyResult.afterEvidence.capturedAt,
                });
                job = this.repository.recordAfterEvidence(context, {
                    jobId: job.id,
                    expectedRevision: job.revision,
                    evidence: after,
                }).job;
                const readback = await adapter.reloadReadback(preparedJob.command, applyResult);
                if (readback.status !== 'VERIFIED') {
                    return this.markUnknownAndStop(context, batchId, job, readback.error.code, readback.error.message);
                }
                const reload = buildExecutionEvidenceInput({
                    storeId: String(context.storeId),
                    batchId,
                    jobId: job.id,
                    slot: 'reload',
                    absolutePath: readback.reloadEvidence.path,
                    pageIdentityHash: fingerprintKeywordBidPageSnapshot(readback.reloadSnapshot),
                    canonicalKeywordId: job.canonicalKeywordId,
                    objectRevision: job.identity.objectRevision,
                    observedBidCents: readback.reloadSnapshot.keyword.bidCents,
                    capturedAt: readback.reloadEvidence.capturedAt,
                });
                job = this.repository.recordReloadVerified(context, {
                    jobId: job.id,
                    expectedRevision: job.revision,
                    evidence: reload,
                }).job;
                this.progress(context, batchId, job.id, 'readback', job.status, '提交后证据与独立刷新回读均已命中目标值。');
            }
            catch (error) {
                if (['intent_written', 'submitted', 'verifying'].includes(job.status)) {
                    const authorityLost = error instanceof ExecutionAuthorityRepositoryError
                        && (error.code === 'INVALID_CONTEXT' || error.code === 'STALE_CONTEXT');
                    return this.markUnknownAndStop(context, batchId, job, authorityLost ? 'ADS_AUTHORITY_LOST_AFTER_INTENT' : 'COORDINATOR_FAILURE_AFTER_INTENT', authorityLost
                        ? 'Ads 会话在保存后失去可信状态，提交结果必须人工核对。'
                        : safeMessage(error));
                }
                return this.requireBatch(context, batchId);
            }
        }
        projection = this.requireBatch(context, batchId);
        if (projection.jobs.every((job) => job.status === 'succeeded')) {
            this.finalizeSucceededBatch(context, projection);
            this.progress(context, batchId, undefined, 'terminal', 'succeeded', '整批动作已完成 before / after / reload 三段证据闭环。');
        }
        return this.requireBatch(context, batchId);
    }
    finally {
        releaseLeaseQuietly(this.leases, lease, this.logger);
    }
}
export async function navigateToJob(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, job: AdExecutionJobProjection, lease: BrowserLease): Promise<ExecutionBrowserRuntime> {
    this.assertContext(context);
    const runtime = this.requireRuntime(context);
    if (runtime.externalAccountId !== job.identity.adsAccountId) {
        throw new Error('执行对象 Ads 账户与当前店铺连接不一致。');
    }
    this.leases.assertCurrent(lease);
    await runtime.navigate(canonicalPageUrl(job.identity.adsAccountId, job.identity.campaignId));
    this.assertLeaseAndRuntime(lease, context, job.identity.adsAccountId);
    return runtime;
}
export function commandFor(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, grant: MissionGrantRecord, job: AdExecutionJobProjection, capsule: StoreCapsulePaths): KeywordBidCommand {
    const evidencePaths = {
        before: executionEvidencePath(capsule, job.batchId, job.id, 'before'),
        after: executionEvidencePath(capsule, job.batchId, job.id, 'after'),
        reload: executionEvidencePath(capsule, job.batchId, job.id, 'reload'),
    };
    for (const target of Object.values(evidencePaths))
        fs.mkdirSync(path.dirname(target), { recursive: true });
    return {
        actionType: 'set_keyword_bid',
        missionGrantId: grant.id,
        storeId: context.storeId,
        browserProfileId: String(context.browserProfileId),
        sessionGeneration: context.sessionGeneration,
        marketplace: 'US',
        currency: 'USD',
        adsAccountId: job.identity.adsAccountId,
        campaignId: job.identity.campaignId,
        adGroupId: job.identity.adGroupId,
        keywordId: job.identity.keywordId,
        objectRevision: job.identity.objectRevision,
        expectedBeforeBidCents: job.expectedBidCents,
        targetBidCents: job.targetBidCents,
        maxChangePct: Math.min(10, grant.maxChangePct),
        pageIdentityExpectation: {
            origin: LINGXING_KEYWORD_BID_ORIGIN,
            pathname: LINGXING_KEYWORD_BID_PATH,
            requiredTextMarkers: [],
        },
        evidencePaths,
    };
}
export function requireBatch(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, batchId: string): AdExecutionBatchProjection {
    const projection = this.repository.getExecutionBatch(context, requiredId(batchId, 'batchId'));
    if (!projection)
        throw new Error('执行批次不存在或不属于当前店铺。');
    return projection;
}
export function requireJob(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, batchId: string, jobId: string): AdExecutionJobProjection {
    const job = this.requireBatch(context, batchId).jobs.find((candidate) => candidate.id === jobId);
    if (!job)
        throw new Error('执行动作不存在或不属于当前批次。');
    return job;
}
export function cancelRemainingBeforeIntent(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, projection: AdExecutionBatchProjection, reasonCode: string): void {
    let current = projection;
    for (const candidate of current.jobs) {
        const job = current.jobs.find((item) => item.id === candidate.id);
        if (!job || (job.status !== 'queued' && job.status !== 'preflight'))
            continue;
        this.repository.cancelJob(context, {
            jobId: job.id,
            expectedRevision: job.revision,
            reasonCode,
            detail: 'Mission batch stopped before this action entered submit intent.',
        });
        current = this.requireBatch(context, projection.batch.id);
    }
}
