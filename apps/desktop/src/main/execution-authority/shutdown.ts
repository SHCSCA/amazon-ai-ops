import { type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { AdmittedAuthorityOperation } from './contracts';
import { ExecutionAuthorityShutdownError } from './errors';
import { waitForExecutionAuthorityDrain } from './values';
import type { ExecutionAuthorityServiceContext } from './context';
export async function withAdmittedBrowserOperation<Result>(this: ExecutionAuthorityServiceContext, label: string, work: () => Promise<Result> | Result): Promise<Result> {
    const admitted = this.admitAuthorityOperation(label);
    try {
        return await work();
    }
    finally {
        admitted.settle();
    }
}
export function assertStoreMutationAllowed(this: ExecutionAuthorityServiceContext, contextInput: StoreContextEnvelope): void {
    const context = this.assertContext(contextInput);
    if (this.policyDispatchLanes.has(String(context.storeId))) {
        throw new Error('当前店铺有策略授权正在建立安全执行批次；派发落账或安全等待后才能切换店铺、重连或修改连接。');
    }
    const active = this.running.get(String(context.storeId));
    if (active) {
        throw new Error(`当前店铺执行批次 ${active.batchId} 正在运行；保存边界完成或在队列中安全取消后才能切换店铺、重连或修改连接。`);
    }
}
export async function prepareForShutdown(this: ExecutionAuthorityServiceContext, timeoutMs = 60000): Promise<void> {
    this.stopping = true;
    for (const storeId of [...this.policyDispatchRetryTimers.keys()]) {
        this.clearPolicyDispatchRetry(storeId);
    }
    [...this.running.values()].forEach((item) => { item.cancelRequested = true; });
    const admitted = [...this.admittedOperations];
    if (admitted.length === 0)
        return;
    try {
        await waitForExecutionAuthorityDrain(admitted, timeoutMs);
    }
    catch (error) {
        let reconciliationError: unknown;
        try {
            this.markPostIntentJobsUnknownForShutdown();
        }
        catch (failure) {
            reconciliationError = failure;
        }
        throw new ExecutionAuthorityShutdownError(timeoutMs, 'Execution authority still owns admitted work at the shutdown deadline.', { cause: reconciliationError ?? error });
    }
    const admittedStillTracked = admitted.some((operation) => this.admittedOperations.has(operation));
    if (admittedStillTracked) {
        let reconciliationError: unknown;
        try {
            this.markPostIntentJobsUnknownForShutdown();
        }
        catch (failure) {
            reconciliationError = failure;
        }
        throw new ExecutionAuthorityShutdownError(timeoutMs, 'Execution authority settlement did not clear the tracked admitted operations.', { cause: reconciliationError });
    }
    this.markPostIntentJobsUnknownForShutdown();
}
export function markPostIntentJobsUnknownForShutdown(this: ExecutionAuthorityServiceContext): void {
    const active = this.storeCoordinator.getActiveStoreContext();
    if (!active)
        return;
    const context = this.assertContext(active);
    for (const projection of this.repository.listExecutionBatches(context)) {
        for (const job of projection.jobs) {
            if (!['intent_written', 'submitted', 'verifying'].includes(job.status))
                continue;
            this.repository.markUnknown(context, {
                jobId: job.id,
                expectedRevision: job.revision,
                reasonCode: 'shutdown_after_intent',
                detail: 'Application shutdown crossed the persisted submit-intent boundary.',
            });
            const current = this.requireBatch(context, projection.batch.id);
            this.cancelRemainingBeforeIntent(context, current, 'batch_stopped_after_unknown');
            this.revokeGrantAndStopMission(context, current, '应用在保存边界后退出，结果必须人工对账。', true);
        }
    }
}
export function admitAuthorityOperation(this: ExecutionAuthorityServiceContext, labelInput: string): AdmittedAuthorityOperation {
    this.assertNotStopping();
    const label = String(labelInput ?? '').trim();
    if (!label)
        throw new TypeError('admitted authority operation label is required');
    let resolveSettlement!: () => void;
    const settlement = new Promise<void>((resolve) => {
        resolveSettlement = resolve;
    });
    this.admittedOperations.add(settlement);
    let settled = false;
    return {
        settlement,
        settle: () => {
            if (settled)
                return;
            settled = true;
            this.admittedOperations.delete(settlement);
            resolveSettlement();
        },
    };
}
export function assertNotStopping(this: ExecutionAuthorityServiceContext): void {
    if (this.stopping)
        throw new Error('应用正在退出，禁止启动新的外部写入。');
}
