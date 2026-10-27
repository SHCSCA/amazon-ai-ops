import { runtimeLogger } from '../runtime-logger';
import  {
  ExecutionAuthorityServiceOptions,
  RunningBatch,
  PolicyDispatchLane,
  PolicyDispatchRetryTimer,
} from './contracts';
import { normalizePolicyDispatchRetryMs } from './values';
import type { ExecutionAuthorityServiceContext } from './context';
import * as identity from './identity';
import * as batches from './batches';
import * as policy_dispatch from './policy-dispatch';
import * as policy_retry from './policy-retry';
import * as authority_checks from './authority-checks';
import * as causal_closure from './causal-closure';
import * as reconciliation from './reconciliation';
import * as shutdown from './shutdown';
import * as progress from './progress';
export function createExecutionAuthorityServiceContext(options: ExecutionAuthorityServiceOptions): ExecutionAuthorityServiceContext {
    const context = { running: new Map<string, RunningBatch>(), policyDispatchLanes: new Map<string, PolicyDispatchLane>(), policyDispatchRetryTimers: new Map<string, PolicyDispatchRetryTimer>(), recoveredBatchReconciliations: new Map<string, Set<string>>(), admittedOperations: new Set<Promise<void>>(), stopping: false } as ExecutionAuthorityServiceContext;
    if (!options.policyDispatchSuppression
        || typeof options.policyDispatchSuppression.isPolicyDispatchSuppressed !== 'function') {
        throw new TypeError('policyDispatchSuppression read port is required');
    }
    context.logger = options.logger ?? runtimeLogger;
    context.repository = options.repository;
    context.missionRepository = options.missionRepository;
    context.analysisRepository = options.analysisRepository;
    context.storeCoordinator = options.storeCoordinator;
    context.leases = options.leases;
    context.resolveBrowserRuntime = options.resolveBrowserRuntime;
    context.emit = options.emitProgress ?? (() => undefined);
    context.now = options.now ?? (() => new Date());
    context.policyDispatchRetryMs = normalizePolicyDispatchRetryMs(options.policyDispatchRetryMs);
    context.policyDispatchTimer = options.policyDispatchTimer ?? {
        set: (callback, delayMs) => setTimeout(callback, delayMs),
        clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    context.policyDispatchSuppression = options.policyDispatchSuppression;
    Object.assign(context, {
        listBatches: batches.listBatches.bind(context),
        withAdmittedBrowserOperation: shutdown.withAdmittedBrowserOperation.bind(context),
        resolveIdentity: identity.resolveIdentity.bind(context),
        resolveIdentityAdmitted: identity.resolveIdentityAdmitted.bind(context),
        createBatch: batches.createBatch.bind(context),
        startBatch: batches.startBatch.bind(context),
        startBatchAdmitted: batches.startBatchAdmitted.bind(context),
        enqueuePolicyGrant: policy_dispatch.enqueuePolicyGrant.bind(context),
        enqueuePolicyGrantAdmitted: policy_dispatch.enqueuePolicyGrantAdmitted.bind(context),
        resumePolicyGrantDispatches: policy_dispatch.resumePolicyGrantDispatches.bind(context),
        resumePolicyGrantDispatchesAdmitted: policy_dispatch.resumePolicyGrantDispatchesAdmitted.bind(context),
        cancelBatch: batches.cancelBatch.bind(context),
        reconcileUnknownBatch: reconciliation.reconcileUnknownBatch.bind(context),
        reconcileUnknownBatchAdmitted: reconciliation.reconcileUnknownBatchAdmitted.bind(context),
        takeOverVisibleBrowser: reconciliation.takeOverVisibleBrowser.bind(context),
        takeOverVisibleBrowserAdmitted: reconciliation.takeOverVisibleBrowserAdmitted.bind(context),
        recoverStartup: reconciliation.recoverStartup.bind(context),
        reconcileActiveStore: reconciliation.reconcileActiveStore.bind(context),
        assertStoreMutationAllowed: shutdown.assertStoreMutationAllowed.bind(context),
        prepareForShutdown: shutdown.prepareForShutdown.bind(context),
        markPostIntentJobsUnknownForShutdown: shutdown.markPostIntentJobsUnknownForShutdown.bind(context),
        runBatch: batches.runBatch.bind(context),
        navigateToJob: batches.navigateToJob.bind(context),
        commandFor: batches.commandFor.bind(context),
        policyGrantDispatch: policy_dispatch.policyGrantDispatch.bind(context),
        wakePolicyGrantPump: policy_dispatch.wakePolicyGrantPump.bind(context),
        runPolicyGrantPump: policy_dispatch.runPolicyGrantPump.bind(context),
        runPolicyGrantPumpAttempt: policy_dispatch.runPolicyGrantPumpAttempt.bind(context),
        completeUnsafeExistingDispatch: policy_dispatch.completeUnsafeExistingDispatch.bind(context),
        ensureAuthorizedExecutionLink: causal_closure.ensureAuthorizedExecutionLink.bind(context),
        reconcileExecutionMissionLinks: causal_closure.reconcileExecutionMissionLinks.bind(context),
        waitPolicyGrantDispatch: policy_retry.waitPolicyGrantDispatch.bind(context),
        holdPolicyGrantDispatchForSuppression: policy_retry.holdPolicyGrantDispatchForSuppression.bind(context),
        schedulePolicyDispatchRetry: policy_retry.schedulePolicyDispatchRetry.bind(context),
        clearPolicyDispatchRetry: policy_retry.clearPolicyDispatchRetry.bind(context),
        assertPolicyPumpRunning: policy_retry.assertPolicyPumpRunning.bind(context),
        policyDispatchIsSuppressed: policy_retry.policyDispatchIsSuppressed.bind(context),
        requireDispatchablePolicyGrant: policy_retry.requireDispatchablePolicyGrant.bind(context),
        requireRuntime: authority_checks.requireRuntime.bind(context),
        assertLeaseAndRuntime: authority_checks.assertLeaseAndRuntime.bind(context),
        requireLiveGrant: authority_checks.requireLiveGrant.bind(context),
        assertGrantUsesEffectivePolicyVersion: authority_checks.assertGrantUsesEffectivePolicyVersion.bind(context),
        requireBatch: batches.requireBatch.bind(context),
        requireJob: batches.requireJob.bind(context),
        cancelRemainingBeforeIntent: batches.cancelRemainingBeforeIntent.bind(context),
        markUnknownAndStop: causal_closure.markUnknownAndStop.bind(context),
        revokeGrantAndStopMission: causal_closure.revokeGrantAndStopMission.bind(context),
        finalizeSucceededBatch: causal_closure.finalizeSucceededBatch.bind(context),
        appendCheckpointOnce: causal_closure.appendCheckpointOnce.bind(context),
        reconcileRecoveredBatches: causal_closure.reconcileRecoveredBatches.bind(context),
        assertContext: authority_checks.assertContext.bind(context),
        admitAuthorityOperation: shutdown.admitAuthorityOperation.bind(context),
        assertNotStopping: shutdown.assertNotStopping.bind(context),
        progress: progress.progress.bind(context),
        timestamp: progress.timestamp.bind(context),
    });
    return context;
}
