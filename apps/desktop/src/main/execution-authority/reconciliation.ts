import fs from 'node:fs';
import path from 'node:path';
import { fingerprintKeywordBidPageSnapshot, PlaywrightLingxingKeywordBidPage } from '@amazon-ai-ops/action-executor';
import { type BrowserLease } from '@amazon-ai-ops/browser-worker';
import  {
  type AdExecutionReconciliationCase,
  type AdExecutionStartupRecoveryResult,
  type AdExecutionUnknownReconciliationResult,
  type ReconcileUnknownAdExecutionBatchRequest,
  type StartAdExecutionBatchRequest,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { executionReconciliationArtifact, executionReconciliationEvidencePath } from '../execution-artifacts';
import  {
  EXECUTION_LEASE_TTL_MS,
  requiredId,
  releaseLeaseQuietly,
  reconciliationResult,
} from './values';
import type { ExecutionAuthorityServiceContext } from './context';
export function reconcileUnknownBatch(this: ExecutionAuthorityServiceContext, request: ReconcileUnknownAdExecutionBatchRequest): Promise<AdExecutionUnknownReconciliationResult> {
    return this.withAdmittedBrowserOperation('reconcile-unknown-execution-batch', () => this.reconcileUnknownBatchAdmitted(request));
}
export async function reconcileUnknownBatchAdmitted(this: ExecutionAuthorityServiceContext, request: ReconcileUnknownAdExecutionBatchRequest): Promise<AdExecutionUnknownReconciliationResult> {
    const context = this.assertContext(request.context);
    const batchId = requiredId(request.batchId, 'batchId');
    const projection = this.requireBatch(context, batchId);
    const unknownJobs = projection.jobs.filter(job => job.status === 'unknown');
    if (projection.batch.status !== 'unknown' || unknownJobs.length !== 1) {
        throw new Error('只有恰好包含一个结果不确定动作的终态批次可以进行只读对账。');
    }
    const job = unknownJobs[0]!;
    const admission = this.repository.beginUnknownReconciliation(context, job.id);
    if (!admission.created)
        return reconciliationResult(admission.record);
    const caseId = admission.record.caseId;
    let lease: BrowserLease | undefined;
    let record: AdExecutionReconciliationCase;
    try {
        const grant = this.missionRepository.getMissionGrant(context, projection.batch.grantId);
        if (!grant)
            throw new Error('原执行记录缺少对象信息。');
        lease = this.leases.acquire({ storeId: context.storeId, purpose: 'external_write', owner: 'reconcile-unknown:' + caseId, ttlMs: EXECUTION_LEASE_TTL_MS });
        const runtime = await this.navigateToJob(context, job, lease);
        const command = this.commandFor(context, grant, job, runtime.capsule);
        const page = new PlaywrightLingxingKeywordBidPage(runtime.page);
        for (const slot of ['first', 'reload'] as const) {
            this.assertLeaseAndRuntime(lease, context, job.identity.adsAccountId);
            if (slot === 'reload')
                await page.reload();
            this.assertLeaseAndRuntime(lease, context, job.identity.adsAccountId);
            const snapshot = await page.readSnapshot(command);
            this.assertLeaseAndRuntime(lease, context, job.identity.adsAccountId);
            const proofPath = executionReconciliationEvidencePath(runtime.capsule, batchId, job.id, slot, context.sessionGeneration, caseId);
            fs.mkdirSync(path.dirname(proofPath), { recursive: true });
            if (fs.existsSync(proofPath))
                throw new Error('该对账观察已有证据，禁止覆盖。');
            await page.captureScreenshot(proofPath);
            this.assertLeaseAndRuntime(lease, context, job.identity.adsAccountId);
            const confirmed = await page.readSnapshot(command);
            this.assertLeaseAndRuntime(lease, context, job.identity.adsAccountId);
            const pageIdentityHash = fingerprintKeywordBidPageSnapshot(snapshot);
            if (pageIdentityHash !== fingerprintKeywordBidPageSnapshot(confirmed) || snapshot.keyword.bidCents !== confirmed.keyword.bidCents) {
                throw new Error('对账截图前后对象或竞价不一致。');
            }
            this.repository.recordUnknownObservation(context, caseId, slot, {
                ...executionReconciliationArtifact(String(context.storeId), batchId, job.id, slot, proofPath),
                capturedAt: this.now().toISOString(), pageIdentityHash,
                canonicalKeywordId: job.canonicalKeywordId, objectRevision: job.identity.objectRevision,
                adsAccountId: confirmed.pageIdentity.adsAccountId, campaignId: confirmed.pageIdentity.campaignId,
                adGroupId: confirmed.keyword.adGroupId, keywordId: confirmed.keyword.keywordId,
                observedBidCents: confirmed.keyword.bidCents,
            });
        }
        record = this.repository.finishUnknownReconciliation(context, caseId);
    }
    catch {
        record = this.repository.finishUnknownReconciliation(context, caseId, true);
    }
    finally {
        if (lease)
            releaseLeaseQuietly(this.leases, lease, this.logger);
    }
    this.assertContext(context);
    const result = reconciliationResult(record);
    this.progress(context, batchId, job.id, 'readback', 'unknown', result.detail);
    return result;
}
export function takeOverVisibleBrowser(this: ExecutionAuthorityServiceContext, request: StartAdExecutionBatchRequest): Promise<{
    status: 'VISIBLE';
    batchId: string;
}> {
    return this.withAdmittedBrowserOperation('take-over-visible-browser', () => this.takeOverVisibleBrowserAdmitted(request));
}
export async function takeOverVisibleBrowserAdmitted(this: ExecutionAuthorityServiceContext, request: StartAdExecutionBatchRequest): Promise<{
    status: 'VISIBLE';
    batchId: string;
}> {
    const context = this.assertContext(request.context);
    const batchId = requiredId(request.batchId, 'batchId');
    this.requireBatch(context, batchId);
    const lease = this.leases.acquire({
        storeId: context.storeId,
        purpose: 'external_write',
        owner: `takeover:${batchId}`,
        ttlMs: EXECUTION_LEASE_TTL_MS,
    });
    try {
        const runtime = this.requireRuntime(context);
        this.assertLeaseAndRuntime(lease, context, runtime.externalAccountId);
        await runtime.bringToFront();
        this.assertLeaseAndRuntime(lease, context, runtime.externalAccountId);
        this.progress(context, batchId, undefined, 'takeover', 'ready', '已将当前店铺的可见 Ads 浏览器置于前台。');
        return { status: 'VISIBLE', batchId };
    }
    finally {
        releaseLeaseQuietly(this.leases, lease, this.logger);
    }
}
export function recoverStartup(this: ExecutionAuthorityServiceContext): AdExecutionStartupRecoveryResult {
    const result = this.repository.recoverInterruptedExecutions();
    const active = this.storeCoordinator.getActiveStoreContext();
    if (active) {
        this.reconcileExecutionMissionLinks(this.assertContext(active));
    }
    this.repository.recoverPolicyGrantDispatchesOnStartup();
    for (const item of result.domainReconciliations) {
        const batches = this.recoveredBatchReconciliations.get(String(item.storeId)) ?? new Set<string>();
        batches.add(item.batchId);
        this.recoveredBatchReconciliations.set(String(item.storeId), batches);
    }
    if (active) {
        this.reconcileRecoveredBatches(active);
        if (this.policyDispatchIsSuppressed())
            return result;
        void this.wakePolicyGrantPump(active, 'startup_recovery').catch(() => {
            this.progress(active, 'policy-dispatch-lane', undefined, 'terminal', 'blocked', '策略派发启动恢复暂未完成，已保留持久化状态。');
        });
    }
    return result;
}
export function reconcileActiveStore(this: ExecutionAuthorityServiceContext, contextInput: StoreContextEnvelope): void {
    const context = this.assertContext(contextInput);
    this.reconcileExecutionMissionLinks(context);
    this.reconcileRecoveredBatches(context);
}
