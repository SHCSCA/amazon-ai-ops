import { type PolicyGrantDispatchTrigger } from '@amazon-ai-ops/local-db';
import { type MissionGrantRecord, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { PolicyGrantDispatchFailure } from './errors';
import { requiredId, assertExecutionWindowOpen, safeMessage } from './values';
import type { ExecutionAuthorityServiceContext } from './context';
export function waitPolicyGrantDispatch(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, grantId: string, trigger: PolicyGrantDispatchTrigger, attempt: number, batchId: string | undefined, error: unknown): 'wait' {
    const nextRetryAt = new Date(this.now().getTime() + this.policyDispatchRetryMs).toISOString();
    const suppressed = this.policyDispatchIsSuppressed();
    this.repository.appendPolicyGrantDispatchEvent(context, {
        grantId,
        status: 'waiting_runtime',
        trigger,
        attempt,
        code: batchId ? 'EXECUTION_RETRY_SCHEDULED' : 'RUNTIME_UNAVAILABLE',
        detail: safeMessage(error),
        ...(batchId ? { batchId } : {}),
        ...(!this.stopping && !suppressed ? { nextRetryAt } : {}),
    });
    this.progress(context, grantId, undefined, 'terminal', 'blocked', `策略授权已安全保留，等待受控恢复：${safeMessage(error)}`);
    if (!this.stopping && !suppressed)
        this.schedulePolicyDispatchRetry(context, nextRetryAt);
    return 'wait';
}
export function holdPolicyGrantDispatchForSuppression(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, grantId: string, trigger: PolicyGrantDispatchTrigger, attempt: number): 'suppressed' {
    const current = this.policyGrantDispatch(context, grantId);
    this.clearPolicyDispatchRetry(String(context.storeId));
    if (current.status === 'attempting') {
        this.repository.appendPolicyGrantDispatchEvent(context, {
            grantId,
            status: 'waiting_runtime',
            trigger,
            attempt,
            code: 'RUNTIME_UNAVAILABLE',
            detail: 'Policy dispatch is suppressed by active Main collection authority.',
            ...(current.batchId ? { batchId: current.batchId } : {}),
        });
    }
    return 'suppressed';
}
export function schedulePolicyDispatchRetry(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, nextRetryAt: string): void {
    if (this.stopping)
        return;
    const storeKey = String(context.storeId);
    if (this.policyDispatchIsSuppressed()) {
        this.clearPolicyDispatchRetry(storeKey);
        return;
    }
    const existing = this.policyDispatchRetryTimers.get(storeKey);
    if (existing && Date.parse(existing.nextRetryAt) <= Date.parse(nextRetryAt))
        return;
    this.clearPolicyDispatchRetry(storeKey);
    const delayMs = Math.max(1, Date.parse(nextRetryAt) - this.now().getTime());
    const handle = this.policyDispatchTimer.set(() => {
        const scheduled = this.policyDispatchRetryTimers.get(storeKey);
        if (!scheduled || scheduled.handle !== handle)
            return;
        this.policyDispatchRetryTimers.delete(storeKey);
        if (this.stopping)
            return;
        if (this.policyDispatchIsSuppressed())
            return;
        const active = this.storeCoordinator.getActiveStoreContext();
        if (!active || String(active.storeId) !== storeKey)
            return;
        void this.wakePolicyGrantPump(active, 'timer_retry').catch(() => {
            this.progress(active, 'policy-dispatch-lane', undefined, 'terminal', 'blocked', '策略派发定时恢复暂未完成，持久化状态保持不变。');
        });
    }, delayMs);
    if (handle && typeof handle === 'object' && 'unref' in handle
        && typeof (handle as {
            unref?: unknown;
        }).unref === 'function') {
        (handle as {
            unref(): void;
        }).unref();
    }
    this.policyDispatchRetryTimers.set(storeKey, { context, nextRetryAt, handle });
}
export function clearPolicyDispatchRetry(this: ExecutionAuthorityServiceContext, storeKey: string): void {
    const scheduled = this.policyDispatchRetryTimers.get(storeKey);
    if (!scheduled)
        return;
    this.policyDispatchRetryTimers.delete(storeKey);
    this.policyDispatchTimer.clear(scheduled.handle);
}
export function assertPolicyPumpRunning(this: ExecutionAuthorityServiceContext): void {
    if (this.stopping) {
        throw new PolicyGrantDispatchFailure('waiting_runtime', 'RUNTIME_UNAVAILABLE', 'Application shutdown is in progress.');
    }
}
export function policyDispatchIsSuppressed(this: ExecutionAuthorityServiceContext): boolean {
    try {
        return this.policyDispatchSuppression.isPolicyDispatchSuppressed() !== false;
    }
    catch (error) {
        this.logger.error('execution.policy_suppression_read_failed', { error });
        return true;
    }
}
export function requireDispatchablePolicyGrant(this: ExecutionAuthorityServiceContext, context: StoreContextEnvelope, grantIdInput: string): MissionGrantRecord {
    const grantId = requiredId(grantIdInput, 'grantId');
    const grant = this.missionRepository.getMissionGrant(context, grantId);
    if (!grant || grant.issuer.type !== 'policy') {
        throw new PolicyGrantDispatchFailure('attention_required', 'UNSAFE_DISPATCH_FAILURE', 'The policy grant is missing or no longer has policy issuer authority.');
    }
    if (grant.createdSessionGeneration !== context.sessionGeneration) {
        throw new PolicyGrantDispatchFailure('attention_required', 'SESSION_REAUTHORIZATION_REQUIRED', 'The grant belongs to an earlier store session and cannot be rebound automatically.');
    }
    if (Date.parse(grant.expiresAt) <= this.now().getTime()) {
        throw new PolicyGrantDispatchFailure('attention_required', 'GRANT_EXPIRED', 'The policy grant expired before a durable execution batch was created.');
    }
    if (this.missionRepository.getMissionGrantTerminalEvent(context, grant.id)) {
        throw new PolicyGrantDispatchFailure('attention_required', 'GRANT_TERMINAL', 'The policy grant is terminal and cannot be dispatched again.');
    }
    const mission = this.missionRepository.getMission(context, grant.missionId);
    if (!mission || mission.status !== 'active'
        || mission.revision !== grant.missionRevision
        || mission.policyVersionId !== grant.policyVersionId) {
        throw new PolicyGrantDispatchFailure('attention_required', 'MISSION_REVISION_CHANGED', 'The Mission authority changed; rerun analysis before issuing a fresh grant.');
    }
    const policy = this.missionRepository.getPolicyVersion(context, grant.policyVersionId);
    if (!policy || policy.status !== 'enabled' || policy.revision !== grant.policyRevision) {
        throw new PolicyGrantDispatchFailure('attention_required', 'POLICY_AUTHORITY_CHANGED', 'The enabled policy revision changed; rerun policy evaluation before execution.');
    }
    try {
        assertExecutionWindowOpen(policy.rules, context, this.now());
    }
    catch (error) {
        const message = safeMessage(error);
        if (message.includes('当前不在策略允许的执行窗口内')) {
            throw new PolicyGrantDispatchFailure('waiting_runtime', 'RUNTIME_UNAVAILABLE', 'The policy execution window is currently closed.');
        }
        throw new PolicyGrantDispatchFailure('attention_required', 'POLICY_AUTHORITY_CHANGED', message);
    }
    try {
        this.assertGrantUsesEffectivePolicyVersion(context, grant);
    }
    catch (error) {
        throw new PolicyGrantDispatchFailure('attention_required', 'POLICY_AUTHORITY_CHANGED', safeMessage(error));
    }
    const runtime = this.missionRepository.getPolicyRuntime(context);
    if (runtime.killSwitch
        || runtime.circuitBreakerState !== 'closed'
        || !runtime.activePolicyVersionId
        || runtime.autonomyMode !== 'policy_auto') {
        throw new PolicyGrantDispatchFailure('waiting_runtime', 'RUNTIME_UNAVAILABLE', 'Policy-auto runtime, kill switch, circuit breaker, or active policy is not ready.');
    }
    return grant;
}
