import {
  type StoreId,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionOrchestratorCycleRequest,
  type StoreCollectionOrchestratorCycleResult,
  type StoreCollectionOrchestratorTransition,
  StoreCollectionOrchestratorError,
  type StoreCollectionAutomationLease,
  type StoreCollectionOrchestratorOutcome,
  type StoreCollectionAuthorityReadback,
  type StoreCollectionPolicySuppressionLease,
} from "./collection-orchestrator-contracts";
import {
  emptyCycleResult,
} from "./collection-orchestrator-integrity";
import {
  cloneAuthority,
  cloneAuthorityReadback,
} from "./collection-orchestrator-authority-values";
import {
  isTerminalPhase,
  combineFailures,
  isStoreCollectionTransitionPhaseAllowed,
} from "./collection-orchestrator-failure-values";

import type { StoreCollectionOrchestratorRuntime } from './collection-orchestrator-runtime';

export async function executeCycle(this: StoreCollectionOrchestratorRuntime,
  request: StoreCollectionOrchestratorCycleRequest): Promise<StoreCollectionOrchestratorCycleResult> {
    let pendingTransitions: StoreCollectionOrchestratorTransition[];
    let attemptedCollectionKeys: ReadonlySet<string>;
    try {
      const historySnapshot = this.readProtectedHistorySnapshot();
      pendingTransitions = historySnapshot.transitions
        .filter((transition) => !isTerminalPhase(transition.phase));
      attemptedCollectionKeys = this.attemptedCollectionSemanticKeys(historySnapshot);
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
    const cycleId = this.createCycleId();
    const manualRecoveryOnly = request.mode === 'manual' && pendingTransitions.length > 0;
    if (request.mode === 'recover_existing_only' && pendingTransitions.length === 0) {
      return emptyCycleResult(cycleId);
    }
    let activeStores: StoreRecord[];
    try {
      activeStores = this.stableActiveStoreSnapshot();
    } catch (error) {
      if (error instanceof StoreCollectionOrchestratorError
        && error.code === 'UNSUPPORTED_STORE') {
        throw error;
      }
      throw this.markSafetyUnknown(error);
    }
    try {
      // 先验证全部持久权限快照，避免改写未知店铺历史。
      for (const transition of pendingTransitions) {
        this.assertAuthorityAgainstActiveStoreSnapshot(transition.fromAuthority, activeStores);
        this.assertAuthorityAgainstActiveStoreSnapshot(transition.originAuthority, activeStores);
      }
      const untouched = pendingTransitions.filter((transition) => transition.phase === 'claimed');
      if (untouched.length > 0) this.interruptTransitions(untouched);
      pendingTransitions = pendingTransitions.filter((transition) => transition.phase !== 'claimed');
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
    if ((request.mode === 'recover_existing_only' || manualRecoveryOnly)
      && pendingTransitions.length === 0) {
      return emptyCycleResult(cycleId);
    }
    let dueSnapshot: {
      due: Array<{
        store: StoreRecord;
        expectedFingerprint: string;
        requiredBusinessDate?: string;
      }>;
      skipped: StoreRecord[];
    } = request.mode === 'normal'
      ? this.stableDueStoreSnapshot(activeStores, attemptedCollectionKeys)
      : { due: [], skipped: [] };
    const manualStore = request.mode === 'manual' && !manualRecoveryOnly
      ? this.exactActiveManualStore(request.context, activeStores)
      : undefined;
    if (request.mode !== 'manual'
      && dueSnapshot.due.length === 0
      && pendingTransitions.length === 0) {
      return {
        cycleId,
        state: 'completed',
        outcomes: [],
        skippedStoreIds: dueSnapshot.skipped.map((store) => store.storeId),
        plannedDueStoreIds: [],
        attemptedStoreIds: [],
      };
    }

    let acquired: StoreCollectionAutomationLease;
    try {
      acquired = await this.dependencies.acquireAutomationLease();
    } catch {
      // 租约获取失败前未触碰权限或浏览器，无需触发清理。
      throw new StoreCollectionOrchestratorError('AUTOMATION_LEASE_UNAVAILABLE', '无法获得 Main 自动化租约。');
    }
    try {
      this.assertFreshAutomationLease(acquired, cycleId);
    } catch (error) {
      if (!this.hasRegisteredCapabilityIdentity(acquired?.capability)) {
        await this.releaseMalformedAutomationLease(acquired);
      }
      throw this.markSafetyUnknown(error);
    }

    const lease = acquired;
    const auth = cloneAuthority(lease);
    const outcomes: StoreCollectionOrchestratorOutcome[] = [];
    const attemptedStoreIds: StoreId[] = [];
    let currentAuthority: StoreCollectionAuthorityReadback | undefined;
    let operatorAuthority: StoreCollectionAuthorityReadback | undefined;
    let policyLease: StoreCollectionPolicySuppressionLease | undefined;
    let touchedAuthorityOrRuntime = false;
    let operatorRestoreProven = false;
    let handledRecovery = false;
    let cycleError: unknown;

    try {
      policyLease = await this.acquirePolicySuppression(auth, cycleId);
      await this.assertPolicySuppressed(auth, policyLease.guard);
      currentAuthority = await this.readAuthority(auth);
      this.assertAuthorityAgainstActiveStoreSnapshot(currentAuthority, activeStores);

      let operatorStoreId: StoreId | null | undefined;
      if (request.mode === 'manual' && manualStore) {
        this.assertManualContextCurrent(request.context, currentAuthority);
        try {
          operatorStoreId = this.dependencies.getActiveStoreId();
        } catch (error) {
          throw this.markSafetyUnknown(error);
        }
        if (operatorStoreId !== request.context.storeId) {
          throw new StoreCollectionOrchestratorError(
            'USER_OPERATION_BLOCKED',
            '手动采集上下文已过期；Main 当前活动店铺不一致。',
          );
        }
        dueSnapshot = this.stableManualStoreSnapshot(
          manualStore,
          request.context,
          attemptedCollectionKeys,
        );
        currentAuthority = await this.readAuthority(auth);
        this.assertAuthorityAgainstActiveStoreSnapshot(currentAuthority, activeStores);
        this.assertManualContextCurrent(request.context, currentAuthority);
        try {
          operatorStoreId = this.dependencies.getActiveStoreId();
        } catch (error) {
          throw this.markSafetyUnknown(error);
        }
        if (operatorStoreId !== request.context.storeId) {
          throw new StoreCollectionOrchestratorError(
            'USER_OPERATION_BLOCKED',
            '手动采集资格预检后 Main 活动店铺已改变；未创建 scheduler request。',
          );
        }
      }

      if (pendingTransitions.length > 0) {
        handledRecovery = true;
        const recoveryPlans = await this.recoverPendingTransitions({
          transitions: pendingTransitions,
          auth,
          policyGuard: policyLease.guard,
        });
        pendingTransitions = recoveryPlans.map((plan) => plan.transition);
        const recoveryOrigin = this.commonRecoveryOrigin(pendingTransitions);
        operatorAuthority = cloneAuthorityReadback(recoveryOrigin);
        touchedAuthorityOrRuntime = true;
        currentAuthority = await this.restoreOperatorStore({
          cycleId,
          currentAuthority,
          operatorAuthority: recoveryOrigin,
          auth,
          policyGuard: policyLease.guard,
        });
        const interruptible = recoveryPlans
          .filter((plan) => plan.disposition === 'interrupt')
          .map((plan) => plan.transition);
        this.interruptTransitions(interruptible);
        for (const plan of recoveryPlans) {
          if (plan.disposition === 'scheduler_succeeded') {
            const finalized = this.finalizeRecoveredSchedulerTransition(plan, true);
            outcomes.push(finalized);
          } else if (plan.disposition === 'scheduler_failed') {
            const finalized = this.finalizeRecoveredSchedulerTransition(plan, false);
            outcomes.push(finalized);
          } else if (plan.disposition === 'scheduler_not_created') {
            const finalized = this.finalizeRecoveredSchedulerTransition(
              plan,
              false,
              'SCHEDULER_NOT_SUCCEEDED',
            );
            outcomes.push(finalized);
          }
        }
        operatorRestoreProven = true;
        const unresolved = recoveryPlans.filter((plan) => plan.disposition === 'scheduler_unresolved');
        if (unresolved.length > 0) {
          const recoveryError = unresolved.reduce<unknown>(
            (combined, plan) => combineFailures(combined, plan.error),
            new StoreCollectionOrchestratorError(
              'SAFETY_STATE_UNKNOWN',
              'durable scheduler request 尚无法按原 attempt/request 查询归因；未生成新请求。',
            ),
          );
          throw this.markSafetyUnknown(recoveryError);
        }
      }

      if (operatorStoreId === undefined) {
        try {
          operatorStoreId = this.dependencies.getActiveStoreId();
        } catch (error) {
          throw this.markSafetyUnknown(error);
        }
      }
      if (operatorStoreId !== currentAuthority.activeStoreId) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'Main 操作员店铺与 capability-bound authority 不一致。',
        ));
      }
      operatorAuthority = cloneAuthorityReadback(currentAuthority);
      if (operatorAuthority.activeStoreId !== null
        && !activeStores.some((store) => (
          store.storeId === operatorAuthority!.activeStoreId
          && store.browserProfileId === operatorAuthority!.context?.browserProfileId
        ))) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'OPERATOR_STORE_RESTORE_FAILED',
          'Main 返回的操作员店铺不在活跃店铺快照中。',
        ));
      }

      for (const due of handledRecovery ? [] : dueSnapshot.due) {
        if (this.stopRequested) break;
        attemptedStoreIds.push(due.store.storeId);
        const result = await this.runStore({
          cycleId,
          currentAuthority,
          originAuthority: operatorAuthority,
          due,
          auth,
          policyGuard: policyLease.guard,
          onTouched: () => {
            touchedAuthorityOrRuntime = true;
            operatorRestoreProven = false;
          },
          onRestored: () => {
            operatorRestoreProven = true;
          },
        });
        outcomes.push(result.outcome);
        currentAuthority = result.authority;
        this.assertAuthorityAgainstActiveStoreSnapshot(result.authority, activeStores);
        // 每次恢复后独立回读当前会话，后续店铺必须使用已推进的真实上下文。
        operatorAuthority = cloneAuthorityReadback(result.authority);
        if (result.mustStop) break;
      }
    } catch (error) {
      cycleError = error;
    } finally {
      if (touchedAuthorityOrRuntime && !operatorRestoreProven && operatorAuthority && policyLease) {
        try {
          const knownCurrent = await this.readAuthority(auth);
          currentAuthority = await this.restoreOperatorStore({
            cycleId,
            currentAuthority: knownCurrent,
            operatorAuthority,
            auth,
            policyGuard: policyLease.guard,
          });
          const recoverable = this.readPendingTransitions();
          if (recoverable.length > 0) {
            const recoveryOrigin = this.commonRecoveryOrigin(recoverable);
            this.assertAuthorityExact(recoveryOrigin, operatorAuthority);
            this.interruptTransitions(recoverable.filter((transition) => (
              isStoreCollectionTransitionPhaseAllowed(
                transition.purpose,
                transition.phase,
                'interrupted',
              )
            )));
          }
          operatorRestoreProven = true;
        } catch (restoreError) {
          cycleError = combineFailures(cycleError, this.markSafetyUnknown(restoreError));
        }
      }
      if (policyLease) {
        if (!this.safetyStateUnknown && (!touchedAuthorityOrRuntime || operatorRestoreProven)) {
          try {
            await this.assertPolicySuppressed(auth, policyLease.guard);
            await this.releasePolicySuppression(policyLease, auth);
          } catch (policyReleaseError) {
            cycleError = combineFailures(cycleError, this.markSafetyUnknown(policyReleaseError));
          }
        } else {
          cycleError = combineFailures(cycleError, this.markSafetyUnknown(
            new StoreCollectionOrchestratorError(
              'SAFETY_STATE_UNKNOWN',
              '安全状态未知，policy dispatch suppression guard 保持占用等待人工恢复。',
            ),
          ));
        }
      }
      try {
        await this.releaseAutomationLease(lease, auth);
      } catch (releaseError) {
        cycleError = combineFailures(cycleError, this.markSafetyUnknown(
          new StoreCollectionOrchestratorError('LEASE_RELEASE_FAILED', 'Main 自动化租约释放失败。'),
        ));
      }
    }

    if (this.safetyStateUnknown) throw combineFailures(cycleError, this.safetyError());
    if (cycleError) throw cycleError;
    return {
      cycleId,
      state: this.stopRequested ? 'stopped' : 'completed',
      outcomes,
      skippedStoreIds: dueSnapshot.skipped.map((store) => store.storeId),
      plannedDueStoreIds: dueSnapshot.due.map((due) => due.store.storeId),
      attemptedStoreIds,
    };
  }
