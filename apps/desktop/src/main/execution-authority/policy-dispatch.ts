import { isPolicyExecutionBatchSafelyRestartable, type PolicyGrantDispatchRecord, type PolicyGrantDispatchTrigger } from '@amazon-ai-ops/local-db';
import  {
  isTerminalAdExecutionStatus,
  type AdExecutionBatchProjection,
  type MissionGrantRecord,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { PolicyDispatchLane } from './contracts';
import { classifyPolicyGrantDispatchFailure } from './dispatch-values';
import { requiredId } from './values';
import type { ExecutionAuthorityServiceContext } from './context';
export function enqueuePolicyGrant(this: ExecutionAuthorityServiceContext, contextInput: StoreContextEnvelope, grant: MissionGrantRecord): Promise<void> {
    return this.withAdmittedBrowserOperation('enqueue-policy-grant', () => this.enqueuePolicyGrantAdmitted(contextInput, grant));
}
export async function enqueuePolicyGrantAdmitted(this: ExecutionAuthorityServiceContext, contextInput: StoreContextEnvelope, grant: MissionGrantRecord): Promise<void> {
    const context = this.assertContext(contextInput);
    if (grant.issuer.type !== 'policy')
        throw new Error('只有 policy MissionGrant 可进入自动执行入口。');
    const durable = this.missionRepository.getMissionGrant(context, grant.id);
    if (!durable || durable.issuer.type !== 'policy') {
        throw new Error('Policy MissionGrant 不存在、跨店铺或签发者不匹配。');
    }
    const current = this.policyGrantDispatch(context, grant.id);
    if (current.status === 'completed' || current.status === 'attention_required')
        return;
    if (!current.eventId) {
        this.repository.appendPolicyGrantDispatchEvent(context, {
            grantId: grant.id,
            status: 'pending',
            trigger: 'grant_issued',
            attempt: 0,
            code: 'DISPATCH_PENDING',
            detail: 'Policy grant was durably journaled before browser or identity work started.',
        });
    }
    if (this.policyDispatchIsSuppressed()) {
        this.clearPolicyDispatchRetry(String(context.storeId));
        return;
    }
    await this.wakePolicyGrantPump(context, 'grant_issued');
}
export function resumePolicyGrantDispatches(this: ExecutionAuthorityServiceContext, contextInput: StoreContextEnvelope, trigger: Extract<PolicyGrantDispatchTrigger, 'store_activated' | 'session_ready'>): Promise<void> {
    return this.withAdmittedBrowserOperation('resume-policy-grant-dispatches', () => this.resumePolicyGrantDispatchesAdmitted(contextInput, trigger));
}
export async function resumePolicyGrantDispatchesAdmitted(this: ExecutionAuthorityServiceContext, contextInput: StoreContextEnvelope, trigger: Extract<PolicyGrantDispatchTrigger, 'store_activated' | 'session_ready'>): Promise<void> {
    const context = this.assertContext(contextInput);
    if (this.policyDispatchIsSuppressed()) {
        this.clearPolicyDispatchRetry(String(context.storeId));
        return;
    }
    await this.wakePolicyGrantPump(context, trigger);
}
export function policyGrantDispatch(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, grantId: string): PolicyGrantDispatchRecord {
    const dispatch = this.repository.listPolicyGrantDispatches(context)
        .find((candidate) => candidate.grantId === requiredId(grantId, 'grantId'));
    if (!dispatch)
        throw new Error('Policy MissionGrant 尚未进入可恢复的派发账本。');
    return dispatch;
}
export function wakePolicyGrantPump(this: ExecutionAuthorityServiceContext, contextInput: StoreContextEnvelope, trigger: PolicyGrantDispatchTrigger): Promise<void> {
    const context = this.assertContext(contextInput);
    if (this.stopping)
        return Promise.resolve();
    const storeKey = String(context.storeId);
    if (this.policyDispatchIsSuppressed()) {
        this.clearPolicyDispatchRetry(storeKey);
        return Promise.resolve();
    }
    const active = this.policyDispatchLanes.get(storeKey);
    if (active) {
        active.rerunRequested = true;
        active.trigger = trigger;
        return active.promise;
    }
    this.clearPolicyDispatchRetry(storeKey);
    const lane: PolicyDispatchLane = {
        context,
        trigger,
        rerunRequested: false,
        promise: Promise.resolve(),
    };
    lane.promise = this.withAdmittedBrowserOperation('policy-grant-dispatch', async () => {
        try {
            await this.runPolicyGrantPump(lane);
        }
        finally {
            if (this.policyDispatchLanes.get(storeKey) === lane) {
                this.policyDispatchLanes.delete(storeKey);
            }
        }
    });
    this.policyDispatchLanes.set(storeKey, lane);
    return lane.promise;
}
export async function runPolicyGrantPump(this: ExecutionAuthorityServiceContext, lane: PolicyDispatchLane): Promise<void> {
    do {
        lane.rerunRequested = false;
        while (!this.stopping) {
            if (this.policyDispatchIsSuppressed()) {
                this.clearPolicyDispatchRetry(String(lane.context.storeId));
                return;
            }
            const dispatches = this.repository.listPolicyGrantDispatches(lane.context);
            const candidate = dispatches.find((dispatch) => (dispatch.status === 'pending'
                || dispatch.status === 'waiting_runtime'
                || dispatch.status === 'queued_for_execution'));
            if (!candidate)
                break;
            if (this.policyDispatchIsSuppressed())
                return;
            if (candidate.status === 'waiting_runtime'
                && lane.trigger === 'timer_retry'
                && candidate.nextRetryAt
                && Date.parse(candidate.nextRetryAt) > this.now().getTime()) {
                this.schedulePolicyDispatchRetry(lane.context, candidate.nextRetryAt);
                break;
            }
            const outcome = await this.runPolicyGrantPumpAttempt(lane.context, candidate, lane.trigger);
            if (outcome === 'wait' || outcome === 'suppressed')
                return;
        }
    } while (lane.rerunRequested && !this.stopping);
}
export async function runPolicyGrantPumpAttempt(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, candidate: PolicyGrantDispatchRecord, trigger: PolicyGrantDispatchTrigger): Promise<'continue' | 'wait' | 'suppressed'> {
    const grantId = candidate.grantId;
    if (this.policyDispatchIsSuppressed())
        return 'suppressed';
    let current = candidate;
    if (!current.eventId) {
        this.repository.appendPolicyGrantDispatchEvent(context, {
            grantId,
            status: 'pending',
            trigger,
            attempt: 0,
            code: 'DISPATCH_PENDING',
            detail: 'A policy grant is durably pending in the store execution lane.',
        });
        current = this.policyGrantDispatch(context, grantId);
    }
    if (this.policyDispatchIsSuppressed())
        return 'suppressed';
    const attempt = current.attemptCount + 1;
    this.repository.appendPolicyGrantDispatchEvent(context, {
        grantId,
        status: 'attempting',
        trigger,
        attempt,
        code: 'DISPATCH_ATTEMPT_STARTED',
        detail: 'The store execution lane started a dispatch attempt.',
        ...(current.batchId ? { batchId: current.batchId } : {}),
    });
    try {
        if (this.policyDispatchIsSuppressed()) {
            return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
        }
        this.assertPolicyPumpRunning();
        const grant = this.requireDispatchablePolicyGrant(context, grantId);
        if (this.policyDispatchIsSuppressed()) {
            return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
        }
        this.requireRuntime(context);
        let batch: AdExecutionBatchProjection;
        const refreshed = this.policyGrantDispatch(context, grantId);
        if (refreshed.batchId || refreshed.batchJobCount > 0) {
            if (!refreshed.batchId) {
                return this.completeUnsafeExistingDispatch(context, refreshed, trigger, attempt);
            }
            const existing = this.repository.getExecutionBatch(context, refreshed.batchId);
            if (!existing || !isPolicyExecutionBatchSafelyRestartable(existing)) {
                return this.completeUnsafeExistingDispatch(context, refreshed, trigger, attempt);
            }
            batch = existing;
        }
        else {
            for (const adEntityId of grant.allowedAdEntityIds) {
                if (this.policyDispatchIsSuppressed()) {
                    return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
                }
                await this.resolveIdentity({ context, grantId: grant.id, adEntityId });
                if (this.policyDispatchIsSuppressed()) {
                    return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
                }
            }
            this.assertPolicyPumpRunning();
            if (this.policyDispatchIsSuppressed()) {
                return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
            }
            const created = this.createBatch({ context, grantId });
            batch = created.projection;
            if (!isPolicyExecutionBatchSafelyRestartable(batch)) {
                return this.completeUnsafeExistingDispatch(context, this.policyGrantDispatch(context, grantId), trigger, attempt);
            }
            this.repository.appendPolicyGrantDispatchEvent(context, {
                grantId,
                status: 'queued_for_execution',
                trigger,
                attempt,
                code: 'BATCH_QUEUED_FOR_EXECUTION',
                detail: 'The durable batch is queued for the store execution lane.',
                batchId: batch.batch.id,
            });
        }
        if (this.policyDispatchIsSuppressed()) {
            return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
        }
        this.ensureAuthorizedExecutionLink(context, batch);
        this.assertPolicyPumpRunning();
        this.requireDispatchablePolicyGrant(context, grantId);
        const beforeStart = this.repository.getExecutionBatch(context, batch.batch.id);
        if (!beforeStart || !isPolicyExecutionBatchSafelyRestartable(beforeStart)) {
            return this.completeUnsafeExistingDispatch(context, this.policyGrantDispatch(context, grantId), trigger, attempt);
        }
        if (this.policyDispatchIsSuppressed()) {
            return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
        }
        this.repository.appendPolicyGrantDispatchEvent(context, {
            grantId,
            status: 'queued_for_execution',
            trigger,
            attempt,
            code: 'EXECUTION_START_ACQUIRED',
            detail: 'The store execution lane acquired the pre-intent batch.',
            batchId: beforeStart.batch.id,
        });
        let projection: AdExecutionBatchProjection;
        try {
            if (this.policyDispatchIsSuppressed()) {
                return this.holdPolicyGrantDispatchForSuppression(context, grantId, trigger, attempt);
            }
            projection = await this.startBatch({
                context,
                batchId: beforeStart.batch.id,
            });
        }
        catch (error) {
            const afterError = this.repository.getExecutionBatch(context, beforeStart.batch.id);
            if (afterError && isPolicyExecutionBatchSafelyRestartable(afterError)) {
                return this.waitPolicyGrantDispatch(context, grantId, trigger, attempt, beforeStart.batch.id, error);
            }
            return this.completeUnsafeExistingDispatch(context, this.policyGrantDispatch(context, grantId), trigger, attempt);
        }
        if (isPolicyExecutionBatchSafelyRestartable(projection)) {
            return this.waitPolicyGrantDispatch(context, grantId, trigger, attempt, projection.batch.id, new Error('Execution returned before a durable terminal state.'));
        }
        this.repository.appendPolicyGrantDispatchEvent(context, {
            grantId,
            status: 'completed',
            trigger,
            attempt,
            code: isTerminalAdExecutionStatus(projection.batch.status)
                ? 'EXECUTION_TERMINAL'
                : 'EXECUTION_STATE_REQUIRES_RECONCILIATION',
            detail: 'The execution ledger now owns the durable terminal or reconciliation state.',
            batchId: projection.batch.id,
        });
        return 'continue';
    }
    catch (error) {
        const failure = classifyPolicyGrantDispatchFailure(error);
        const current = this.policyGrantDispatch(context, grantId);
        if (current.batchId || current.batchJobCount > 0) {
            if (failure.status === 'attention_required') {
                this.repository.appendPolicyGrantDispatchEvent(context, {
                    grantId,
                    status: 'attention_required',
                    trigger,
                    attempt,
                    code: failure.code,
                    detail: failure.message,
                    ...(current.batchId ? { batchId: current.batchId } : {}),
                });
                return 'continue';
            }
            const currentBatch = current.batchId
                ? this.repository.getExecutionBatch(context, current.batchId)
                : undefined;
            if (failure.status === 'waiting_runtime'
                && currentBatch
                && isPolicyExecutionBatchSafelyRestartable(currentBatch)) {
                return this.waitPolicyGrantDispatch(context, grantId, trigger, attempt, current.batchId, error);
            }
            return this.completeUnsafeExistingDispatch(context, current, trigger, attempt);
        }
        if (failure.status === 'waiting_runtime') {
            return this.waitPolicyGrantDispatch(context, grantId, trigger, attempt, undefined, error);
        }
        this.repository.appendPolicyGrantDispatchEvent(context, {
            grantId,
            status: 'attention_required',
            trigger,
            attempt,
            code: failure.code,
            detail: failure.message,
        });
        this.progress(context, grantId, undefined, 'terminal', 'blocked', `策略授权派发需要人工修复并重新分析授权：${failure.message}`);
        return 'continue';
    }
}
export function completeUnsafeExistingDispatch(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, dispatch: PolicyGrantDispatchRecord, trigger: PolicyGrantDispatchTrigger, attempt: number): 'continue' {
    if (!dispatch.batchId) {
        this.repository.appendPolicyGrantDispatchEvent(context, {
            grantId: dispatch.grantId,
            status: 'attention_required',
            trigger,
            attempt,
            code: 'UNSAFE_DISPATCH_FAILURE',
            detail: 'Execution jobs exist without a durable batch lineage.',
        });
        return 'continue';
    }
    this.repository.appendPolicyGrantDispatchEvent(context, {
        grantId: dispatch.grantId,
        status: 'completed',
        trigger,
        attempt,
        code: 'EXECUTION_STATE_REQUIRES_RECONCILIATION',
        detail: 'Existing execution state is not safe for automatic restart.',
        batchId: dispatch.batchId,
    });
    return 'continue';
}
