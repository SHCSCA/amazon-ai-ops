import {
  type StoreCollectionAuthorityReadback,
  type StoreCollectionAutomationAuthority,
  type StoreCollectionPolicySuppressionGuard,
  type StoreCollectionExecutionAutomationAuthority,
  StoreCollectionOrchestratorError,
  type StoreCollectionOrchestratorDependencies,
} from "./collection-orchestrator-contracts";
import {
  storeFromContext,
  cloneAuthorityReadback,
  authorityMatchesRestoreTarget,
  transitionTargetFromContext,
} from "./collection-orchestrator-authority-values";
import {
  normalizeFailureCode,
  combineFailures,
  isTerminalPhase,
} from "./collection-orchestrator-failure-values";

import type { StoreCollectionOrchestratorRuntime } from './collection-orchestrator-runtime';

export async function restoreOperatorStore(this: StoreCollectionOrchestratorRuntime,
  input: {
    cycleId: string;
    currentAuthority: StoreCollectionAuthorityReadback;
    operatorAuthority: StoreCollectionAuthorityReadback;
    auth: StoreCollectionAutomationAuthority;
    policyGuard: StoreCollectionPolicySuppressionGuard;
  }): Promise<StoreCollectionAuthorityReadback> {
    const { auth, operatorAuthority } = input;
    let transition = this.newTransition({
      cycleId: input.cycleId,
      owner: auth.owner,
      fromStoreId: input.currentAuthority.activeStoreId,
      store: operatorAuthority.context ? storeFromContext(operatorAuthority.context) : null,
      fromAuthority: input.currentAuthority,
      originAuthority: operatorAuthority,
      startedAt: this.now().toISOString(),
      purpose: 'restore',
    });
    let transitionAuth: StoreCollectionExecutionAutomationAuthority | undefined;
    let readback = cloneAuthorityReadback(input.currentAuthority);
    let restoreFailure: unknown;
    try {
      this.appendTransition(transition);
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
    try {
      transitionAuth = await this.deriveTransitionAuthority(
        transition,
        auth,
        input.policyGuard,
        'transition_execution',
      );
      transition = this.updateTransition(transition, { phase: 'authority_touch_pending' });
      readback = await this.readTransitionAuthority(transitionAuth, readback);
      readback = await this.closeAndConfirm(transitionAuth, readback, 'initial');
      transition = this.updateTransition(transition, { phase: 'previous_closed' });

      if (!authorityMatchesRestoreTarget(readback, operatorAuthority)) {
        await this.assertPolicySuppressed(auth, input.policyGuard);
        const target = operatorAuthority.context
          ? transitionTargetFromContext(operatorAuthority.context)
          : null;
        const receipt = await this.dependencies.transitionAuthorityForCollection({
          ...transitionAuth,
          reason: 'collection_automation',
          mode: 'collection_only',
          previous: cloneAuthorityReadback(readback),
          target,
        });
        this.validateTransitionReceipt(receipt, {
          auth: transitionAuth,
          expectedPrevious: readback,
          target,
          minimumTargetAuthority: operatorAuthority,
        });
        await this.assertPolicySuppressed(auth, input.policyGuard);
        readback = await this.readTransitionAuthority(transitionAuth, receipt.current);
        this.assertAuthorityExact(readback, receipt.current);
      }
      transition = this.updateTransition(transition, {
        phase: 'activated',
        ...(readback.context ? {
          businessDate: readback.context.businessDate,
          sessionGeneration: readback.context.sessionGeneration,
        } : {}),
      });
      const activatedAuthority = cloneAuthorityReadback(readback);
      transition = this.updateTransition(transition, { phase: 'cleanup_pending' });

      // 同一切换能力下独立核验权限、浏览器关闭及租约释放后才可终结恢复。
      readback = await this.readTransitionAuthority(transitionAuth, readback);
      readback = await this.closeAndConfirm(transitionAuth, readback, 'terminal_cleanup');
      this.assertAuthorityExact(readback, activatedAuthority);
      if (!authorityMatchesRestoreTarget(readback, operatorAuthority)) {
        throw new StoreCollectionOrchestratorError(
          'OPERATOR_STORE_RESTORE_FAILED',
          '未能证明操作员原店铺或原空 authority 已恢复。',
        );
      }
      transition = this.updateTransition(transition, {
        phase: 'completed',
        completedAt: this.now().toISOString(),
      });
      this.setCapabilityLifecycle(transitionAuth.transitionCapability, 'transition_execution', 'retired');
      return readback;
    } catch (error) {
      restoreFailure = error;
      const failureCode = normalizeFailureCode(error, 'OPERATOR_STORE_RESTORE_FAILED');
      let cleanupProven = false;
      if (transitionAuth) {
        try {
          readback = await this.readTransitionAuthority(transitionAuth, readback);
          readback = await this.closeAndConfirm(transitionAuth, readback, 'terminal_cleanup');
          cleanupProven = authorityMatchesRestoreTarget(readback, operatorAuthority);
        } catch (cleanupError) {
          restoreFailure = combineFailures(restoreFailure, cleanupError);
        }
      }
      try {
        if (!isTerminalPhase(transition.phase) && cleanupProven) {
          transition = this.updateTransition(transition, {
            phase: 'failed',
            completedAt: this.now().toISOString(),
            failureCode,
          });
          this.setCapabilityLifecycle(
            transitionAuth!.transitionCapability,
            'transition_execution',
            'retired',
          );
        }
      } catch (historyError) {
        restoreFailure = combineFailures(restoreFailure, historyError);
      }
      throw this.markSafetyUnknown(combineFailures(
        restoreFailure,
        new StoreCollectionOrchestratorError(
          'OPERATOR_STORE_RESTORE_FAILED',
          '未能证明操作员原店铺已恢复且可见采集运行时已关闭。',
        ),
      ));
    }
  }

export async function closeAndConfirm(this: StoreCollectionOrchestratorRuntime,
  auth: StoreCollectionExecutionAutomationAuthority,
  expectedAuthority: StoreCollectionAuthorityReadback,
  intent: 'initial' | 'terminal_cleanup'): Promise<StoreCollectionAuthorityReadback> {
    this.assertAuthorityWithinTransitionScope(auth, expectedAuthority);
    const visibleRuntimeIntent = this.visibleRuntimeIntent(auth, intent);
    let closeResult: Awaited<ReturnType<StoreCollectionOrchestratorDependencies['closeVisibleRuntime']>>;
    try {
      closeResult = await this.dependencies.closeVisibleRuntime({
        ...auth,
        expectedAuthority: cloneAuthorityReadback(expectedAuthority),
        visibleRuntimeIntent,
      });
      if (!closeResult || closeResult.closed !== true) {
        throw new Error('invalid close confirmation');
      }
      this.assertTransitionCapabilityBound(closeResult, auth);
      this.assertAuthorityExact(closeResult.authority, expectedAuthority);
    } catch (error) {
      if (error instanceof StoreCollectionOrchestratorError
        && error.code === 'SAFETY_STATE_UNKNOWN') {
        throw error;
      }
      throw Object.assign(new StoreCollectionOrchestratorError('RUNTIME_CLOSE_FAILED', '无法证明可见采集运行时已关闭。'), { cause: error });
    }
    try {
      const leaseResult = await this.dependencies.assertCollectionLeaseReleased({
        ...auth,
        expectedAuthority: cloneAuthorityReadback(expectedAuthority),
        visibleRuntimeIntent,
      });
      if (!leaseResult || leaseResult.released !== true) {
        throw new Error('invalid collection lease confirmation');
      }
      this.assertTransitionCapabilityBound(leaseResult, auth);
      this.assertAuthorityExact(leaseResult.authority, expectedAuthority);
    } catch (error) {
      if (error instanceof StoreCollectionOrchestratorError
        && error.code === 'SAFETY_STATE_UNKNOWN') {
        throw error;
      }
      throw Object.assign(new StoreCollectionOrchestratorError('COLLECTION_LEASE_ACTIVE', '无法证明采集租约已释放。'), { cause: error });
    }
    const finalReadback = await this.readTransitionAuthority(auth, expectedAuthority);
    this.assertAuthorityExact(finalReadback, expectedAuthority);
    return finalReadback;
  }
