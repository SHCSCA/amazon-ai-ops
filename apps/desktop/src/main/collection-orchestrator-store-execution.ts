import {
  randomUUID,
} from 'node:crypto';
import {
  type StoreContextEnvelope,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionAuthorityReadback,
  type StoreCollectionAutomationAuthority,
  type StoreCollectionPolicySuppressionGuard,
  type StoreCollectionOrchestratorOutcome,
  type OutcomeState,
  type StoreCollectionOrchestratorFailureCode,
  type StoreCollectionTransitionReceipt,
  ManualContextDriftSignal,
  SchedulerDefinitivelyFailedSignal,
  SchedulerResolutionUnknownSignal,
  StopRequestedSignal,
  StoreCollectionOrchestratorError,
  type TransitionPhase,
} from "./collection-orchestrator-contracts";
import {
  deriveStoreCollectionSchedulerExecutionIdentity,
} from "./collection-orchestrator-integrity";
import {
  cloneAuthorityReadback,
  transitionTargetFromStore,
} from "./collection-orchestrator-authority-values";
import {
  isIdentityFailure,
  normalizeIdentityFailure,
  isCriticalSafetyError,
  normalizeFailureCode,
  combineFailures,
} from "./collection-orchestrator-failure-values";

import type { StoreCollectionOrchestratorRuntime } from './collection-orchestrator-runtime';

export async function runStore(this: StoreCollectionOrchestratorRuntime,
  input: {
    cycleId: string;
    currentAuthority: StoreCollectionAuthorityReadback;
    originAuthority: StoreCollectionAuthorityReadback;
    due: {
      store: StoreRecord;
      expectedFingerprint: string;
      requiredBusinessDate?: string;
    };
    auth: StoreCollectionAutomationAuthority;
    policyGuard: StoreCollectionPolicySuppressionGuard;
    onTouched(): void;
    onRestored(): void;
  }): Promise<{
    outcome: StoreCollectionOrchestratorOutcome;
    authority: StoreCollectionAuthorityReadback;
    mustStop: boolean;
  }> {
    const { cycleId, currentAuthority, originAuthority, due, auth } = input;
    const startedAt = this.now().toISOString();
    let transition = this.newTransition({
      cycleId,
      owner: auth.owner,
      fromStoreId: currentAuthority.activeStoreId,
      store: due.store,
      fromAuthority: currentAuthority,
      originAuthority,
      startedAt,
      purpose: 'collection',
      expectedFingerprint: due.expectedFingerprint,
    });
    try {
      this.appendTransition(transition);
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
    const transitionAuth = await this.deriveTransitionAuthority(
      transition,
      auth,
      input.policyGuard,
      'transition_execution',
    );

    let context: StoreContextEnvelope | undefined;
    let authority = cloneAuthorityReadback(currentAuthority);
    let outcomeState: OutcomeState = 'failed';
    let failureCode: StoreCollectionOrchestratorFailureCode = 'TRANSITION_FAILED';
    let attemptId: string | undefined;
    let requestId: string | undefined;
    let schedulerSucceeded = false;
    let cleanupStatus: StoreCollectionOrchestratorOutcome['cleanupStatus'] = 'confirmed';
    let mustStop = false;
    let criticalError: unknown;
    let bodyFinished = false;
    let schedulerResolutionUnknown = false;
    let schedulerDefinitivelyFailed = false;
    let stage: 'close' | 'transition' | 'runtime_start' | 'identity' | 'scheduler' = 'close';
    try {
      transition = this.updateTransition(transition, { phase: 'authority_touch_pending' });
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
    input.onTouched();

    try {
      authority = await this.closeAndConfirm(transitionAuth, authority, 'initial');
      transition = this.updateTransition(transition, { phase: 'previous_closed' });
      this.throwIfStopping();

      stage = 'transition';
      let receipt: StoreCollectionTransitionReceipt;
      try {
        await this.assertPolicySuppressed(auth, input.policyGuard);
        receipt = await this.dependencies.transitionAuthorityForCollection({
          ...transitionAuth,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous: cloneAuthorityReadback(authority),
          target: transitionTargetFromStore(due.store),
        });
      } catch (error) {
        mustStop = true;
        failureCode = 'TRANSITION_FAILED';
        authority = await this.readTransitionAuthority(transitionAuth, authority);
        throw error;
      }
      context = this.validateTransitionReceipt(receipt, {
        auth: transitionAuth,
        expectedPrevious: authority,
        target: transitionTargetFromStore(due.store),
      })!;
      await this.assertPolicySuppressed(auth, input.policyGuard);
      authority = await this.readTransitionAuthority(transitionAuth, receipt.current);
      this.assertAuthorityExact(authority, receipt.current);
      transition = this.updateTransition(transition, {
        phase: 'activated',
        businessDate: context.businessDate,
        sessionGeneration: context.sessionGeneration,
      });
      if (due.requiredBusinessDate !== undefined
        && context.businessDate !== due.requiredBusinessDate) {
        throw new ManualContextDriftSignal();
      }
      this.throwIfStopping();

      stage = 'runtime_start';
      const started = await this.dependencies.startCollectionOnlyVisibleRuntime({
        ...transitionAuth,
        context,
        expectedAuthority: cloneAuthorityReadback(authority),
        visibleRuntimeIntent: this.visibleRuntimeIntent(transitionAuth, 'initial'),
      });
      this.validateConfirmation(started, transitionAuth, authority, 'started');
      transition = this.updateTransition(transition, { phase: 'runtime_started' });
      this.throwIfStopping();

      stage = 'identity';
      const verified = await this.dependencies.verifyVisibleLingxingIdentity({
        ...transitionAuth,
        context,
        expectedAuthority: cloneAuthorityReadback(authority),
        visibleRuntimeIntent: this.visibleRuntimeIntent(transitionAuth, 'initial'),
      });
      this.validateConfirmation(verified, transitionAuth, authority, 'verified');
      transition = this.updateTransition(transition, { phase: 'identity_verified' });
      this.throwIfStopping();

      stage = 'scheduler';
      await this.assertPolicySuppressed(auth, input.policyGuard);
      const schedulerIdentity = deriveStoreCollectionSchedulerExecutionIdentity({
        cycleId,
        transitionId: transition.transitionId,
        fingerprint: due.expectedFingerprint,
        transitionScope: transitionAuth.transitionScope,
        context,
      });
      transition = this.updateTransition(transition, {
        phase: 'scheduler_request_bound',
        schedulerAttemptId: schedulerIdentity.attemptId,
        schedulerRequestId: schedulerIdentity.requestId,
      });
      attemptId = schedulerIdentity.attemptId;
      requestId = schedulerIdentity.requestId;
      const accepted = await this.dependencies.scheduler.execute({
        ...transitionAuth,
        context,
        expectedAuthority: cloneAuthorityReadback(authority),
        cycleId,
        transitionId: transition.transitionId,
        expectedFingerprint: due.expectedFingerprint,
        ...schedulerIdentity,
      });
      this.validateSchedulerAccepted(accepted, {
        auth: transitionAuth,
        context,
        cycleId,
        transitionId: transition.transitionId,
        expectedFingerprint: due.expectedFingerprint,
      });
      transition = this.updateTransition(transition, { phase: 'scheduler_accepted' });
      const recoveryAdmission = await this.registerProtectedSchedulerRecoveryAdmission(
        transition,
        auth,
      );
      const recoveryAuth = await this.deriveTransitionAuthority(
        transition,
        auth,
        input.policyGuard,
        'recovery_existing_request_only',
        recoveryAdmission,
      );
      const projection = await this.dependencies.scheduler.recover({
        ...recoveryAuth,
        context,
        expectedAuthority: cloneAuthorityReadback(authority),
        cycleId,
        transitionId: transition.transitionId,
        expectedFingerprint: due.expectedFingerprint,
        ...schedulerIdentity,
      });
      const recoveredState = this.validateSchedulerRecovery(projection, {
        auth: recoveryAuth,
        executionIdentityScope: transitionAuth.transitionScope,
        context,
        cycleId,
        transitionId: transition.transitionId,
        expectedFingerprint: due.expectedFingerprint,
      });
      if (recoveredState === 'failed') {
        this.setCapabilityLifecycle(
          recoveryAuth.transitionCapability,
          'transition_recovery',
          'retired',
        );
        schedulerDefinitivelyFailed = true;
        throw new SchedulerDefinitivelyFailedSignal();
      }
      if (recoveredState !== 'succeeded') {
        throw new SchedulerResolutionUnknownSignal();
      }
      this.setCapabilityLifecycle(
        recoveryAuth.transitionCapability,
        'transition_recovery',
        'retired',
      );
      schedulerSucceeded = true;
      transition = this.updateTransition(transition, {
        phase: 'scheduler_reconciled',
      });
      outcomeState = 'succeeded';
      failureCode = undefined as never;
      bodyFinished = true;
    } catch (error) {
      if (error instanceof StopRequestedSignal) {
        failureCode = 'APP_EXIT_INTERRUPTED';
        mustStop = true;
      } else if (error instanceof SchedulerDefinitivelyFailedSignal) {
        failureCode = 'SCHEDULER_FAILED';
        outcomeState = 'failed';
        bodyFinished = true;
      } else if (error instanceof ManualContextDriftSignal) {
        failureCode = 'SCHEDULE_PRECHECK_FAILED';
        outcomeState = 'blocked';
        bodyFinished = true;
        mustStop = true;
      } else if (error instanceof SchedulerResolutionUnknownSignal
        || transition.phase === 'scheduler_request_bound'
        || transition.phase === 'scheduler_accepted') {
        failureCode = 'SAFETY_STATE_UNKNOWN';
        schedulerResolutionUnknown = true;
        criticalError = this.markSafetyUnknown(error);
        mustStop = true;
      } else if (isIdentityFailure(error)) {
        failureCode = normalizeIdentityFailure(error);
        outcomeState = 'blocked';
        bodyFinished = true;
      } else if (isCriticalSafetyError(error)) {
        failureCode = normalizeFailureCode(error, 'SAFETY_STATE_UNKNOWN');
        criticalError = this.markSafetyUnknown(error);
        mustStop = true;
      } else if (error instanceof StoreCollectionOrchestratorError
        && error.code === 'SAFETY_STATE_UNKNOWN') {
        failureCode = error.code;
        criticalError = this.markSafetyUnknown(error);
        mustStop = true;
      } else {
        if (stage === 'runtime_start') {
          failureCode = 'RUNTIME_START_FAILED';
        } else if (stage === 'identity') {
          failureCode = 'IDENTITY_UNVERIFIED';
          outcomeState = 'blocked';
        } else if (stage === 'scheduler') {
          failureCode = 'SCHEDULER_FAILED';
        } else {
          failureCode = 'TRANSITION_FAILED';
          mustStop = true;
        }
        bodyFinished = stage !== 'transition';
      }
    } finally {
      if (context) {
        try {
          if (!schedulerResolutionUnknown && !schedulerDefinitivelyFailed) {
            transition = this.updateTransition(transition, { phase: 'cleanup_pending' });
          }
        } catch (error) {
          criticalError = combineFailures(criticalError, this.markSafetyUnknown(error));
        }
      }
      try {
        const expected = await this.readTransitionAuthority(transitionAuth, authority);
        authority = await this.closeAndConfirm(transitionAuth, expected, 'terminal_cleanup');
      } catch (error) {
        criticalError = combineFailures(criticalError, this.markSafetyUnknown(error));
        failureCode = normalizeFailureCode(error, 'SAFETY_STATE_UNKNOWN');
        outcomeState = 'failed';
        cleanupStatus = 'unknown';
        mustStop = true;
      }
    }

    // 恢复权限、关闭浏览器及释放租约全部证明后，采集切换才可终结。
    try {
      authority = await this.restoreOperatorStore({
        cycleId,
        currentAuthority: authority,
        operatorAuthority: originAuthority,
        auth,
        policyGuard: input.policyGuard,
      });
      input.onRestored();
    } catch (restoreError) {
      criticalError = combineFailures(criticalError, restoreError);
      failureCode = 'OPERATOR_STORE_RESTORE_FAILED';
      outcomeState = 'failed';
      cleanupStatus = 'unknown';
      mustStop = true;
    }

    if (schedulerResolutionUnknown) {
      throw criticalError ?? this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'scheduler 请求结果无法按 durable attempt/request 归因；保留非终态等待恢复查询。',
      ));
    }

    const terminalPhase: TransitionPhase = outcomeState === 'succeeded'
      ? 'completed'
      : outcomeState === 'blocked'
        ? 'blocked'
        : 'failed';
    const completedAt = this.now().toISOString();
    let outcome: StoreCollectionOrchestratorOutcome;
    try {
      ({ transition, outcome } = this.completeCollectionTransition(transition, {
        phase: terminalPhase,
        completedAt,
        ...(failureCode ? { failureCode } : {}),
      }, {
        outcomeId: randomUUID(),
        cycleId,
        transitionId: transition.transitionId,
        owner: auth.owner,
        storeId: due.store.storeId,
        browserProfileId: due.store.browserProfileId,
        ...(context ? {
          businessDate: context.businessDate,
          sessionGeneration: context.sessionGeneration,
        } : {}),
        fingerprint: due.expectedFingerprint,
        ...(attemptId ? { attemptId } : {}),
         ...(requestId ? { requestId } : {}),
        schedulerSucceeded,
        cleanupStatus,
        state: outcomeState,
        startedAt,
        completedAt,
        ...(failureCode ? { failureCode } : {}),
      }));
    } catch (error) {
      criticalError = combineFailures(criticalError, this.markSafetyUnknown(error));
      throw criticalError;
    }
    this.setCapabilityLifecycle(transitionAuth.transitionCapability, 'transition_execution', 'retired');
    if (criticalError) throw criticalError;
    if (!bodyFinished && outcomeState === 'failed') mustStop = true;
    return { outcome, authority, mustStop };
  }
