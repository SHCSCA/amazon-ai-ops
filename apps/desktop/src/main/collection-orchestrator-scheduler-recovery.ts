import {
  randomUUID,
} from 'node:crypto';
import {
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionOrchestratorSchedulerProjection,
  type StoreCollectionExecutionAutomationAuthority,
  StoreCollectionOrchestratorError,
  type StoreCollectionRecoveryAutomationAuthority,
  type StoreCollectionTransitionCapabilityScope,
  type StoreCollectionTransitionCapabilityDomain,
  type StoreCollectionTransitionAutomationAuthority,
  type StoreCollectionOrchestratorTransition,
  type StoreCollectionAutomationAuthority,
  type ProtectedSchedulerRecoveryAdmission,
  type StoreCollectionPolicySuppressionGuard,
  type PendingTransitionRecoveryPlan,
  type StoreCollectionOrchestratorFailureCode,
  type StoreCollectionOrchestratorOutcome,
  type TransitionPhase,
  type StoreCollectionAuthorityReadback,
} from "./collection-orchestrator-contracts";
import {
  deriveStoreCollectionSchedulerExecutionIdentity,
  storeCollectionSchedulerRecoveryAdmissionScopeDigest,
} from "./collection-orchestrator-integrity";
import {
  isSchedulerBoundPendingTransition,
} from "./collection-orchestrator-semantic-values";
import {
  contextFromTransition,
  freezeTransitionScope,
  transitionScopeFromTransition,
  runtimeCapability,
  sameAuthority,
  cloneAuthorityReadback,
} from "./collection-orchestrator-authority-values";

import type { StoreCollectionOrchestratorRuntime } from './collection-orchestrator-runtime';

export function validateSchedulerAccepted(this: StoreCollectionOrchestratorRuntime,
  projection: StoreCollectionOrchestratorSchedulerProjection<'transition_execution'>,
  input: {
      auth: StoreCollectionExecutionAutomationAuthority;
      context: StoreContextEnvelope;
      cycleId: string;
      transitionId: string;
      expectedFingerprint: string;
    }): void {
    if (input.auth.transitionScope.capabilityDomain !== 'transition_execution') {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'scheduler execute 仅接受 transition_execution capability。',
      ));
    }
    this.validateSchedulerProjectionBinding(
      projection,
      input,
      input.auth.transitionScope,
    );
    if (projection.state !== 'accepted'
      || projection.accepted !== true
      || projection.duplicate !== false) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'scheduler execute 未返回 exact durable request 的 accepted 证明。',
      ));
    }
  }

export function validateSchedulerRecovery(this: StoreCollectionOrchestratorRuntime,
  projection: StoreCollectionOrchestratorSchedulerProjection<'recovery_existing_request_only'>,
  input: {
      auth: StoreCollectionRecoveryAutomationAuthority;
      executionIdentityScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>;
      context: StoreContextEnvelope;
      cycleId: string;
      transitionId: string;
      expectedFingerprint: string;
    }): 'accepted' | 'succeeded' | 'failed' | 'not_found' | 'unknown' {
    if (input.auth.transitionScope.capabilityDomain !== 'recovery_existing_request_only') {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'scheduler recover 仅接受 recovery_existing_request_only capability。',
      ));
    }
    this.validateSchedulerProjectionBinding(
      projection,
      input,
      input.executionIdentityScope,
    );
    if (projection.state === 'accepted'
      || projection.state === 'succeeded'
      || projection.state === 'failed') {
      if (projection.accepted !== true || projection.duplicate !== false) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'scheduler recover 状态未绑定已接受的 exact durable request。',
        ));
      }
      return projection.state;
    }
    if (projection.state === 'not_found') {
      if (projection.accepted !== undefined || projection.duplicate !== undefined) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'scheduler recover 的 not_found 回执不得携带已接受标记。',
        ));
      }
      return projection.state;
    }
    return 'unknown';
  }

export function validateSchedulerProjectionBinding<Domain extends StoreCollectionTransitionCapabilityDomain>(this: StoreCollectionOrchestratorRuntime,
  projection: StoreCollectionOrchestratorSchedulerProjection<Domain>,
  input: {
      auth: StoreCollectionTransitionAutomationAuthority<Domain>;
      context: StoreContextEnvelope;
      cycleId: string;
      transitionId: string;
      expectedFingerprint: string;
    },
  executionIdentityScope: StoreCollectionTransitionCapabilityScope<'transition_execution'>): void {
    const expectedIdentity = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: input.cycleId,
      transitionId: input.transitionId,
      fingerprint: input.expectedFingerprint,
      transitionScope: executionIdentityScope,
      context: input.context,
    });
    if (!projection
      || projection.cycleId !== input.cycleId
      || projection.transitionId !== input.transitionId
      || projection.fingerprint !== input.expectedFingerprint
      || projection.attemptId !== expectedIdentity.attemptId
      || projection.requestId !== expectedIdentity.requestId) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'scheduler 回执无法归因到 exact cycle/transition/fingerprint/attempt/request。',
      ));
    }
    this.assertTransitionCapabilityBound(projection, input.auth);
    this.assertAuthority(projection.authority, input.context.storeId);
    this.assertAuthorityExact(projection.authority, { activeStoreId: input.context.storeId, context: input.context });
  }

export async function registerProtectedSchedulerRecoveryAdmission(this: StoreCollectionOrchestratorRuntime,
  transition: StoreCollectionOrchestratorTransition,
  auth: StoreCollectionAutomationAuthority): Promise<ProtectedSchedulerRecoveryAdmission> {
    const verifiedMatches = this.readPendingTransitions().filter((candidate) => (
      candidate.transitionId === transition.transitionId
    ));
    const verified = verifiedMatches[0];
    if (verifiedMatches.length !== 1
      || !verified
      || verified.integrityDigest !== transition.integrityDigest
      || !isSchedulerBoundPendingTransition(verified)) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'protected history 未唯一证明 scheduler-bound pending transition。',
      ));
    }
    const context = contextFromTransition(verified);
    const executionScope = freezeTransitionScope(
      transitionScopeFromTransition(verified, 'transition_execution'),
    );
    const identity = deriveStoreCollectionSchedulerExecutionIdentity({
      cycleId: verified.cycleId,
      transitionId: verified.transitionId,
      fingerprint: verified.expectedFingerprint!,
      transitionScope: executionScope,
      context,
    });
    if (identity.attemptId !== verified.schedulerAttemptId
      || identity.requestId !== verified.schedulerRequestId) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'protected history 的 scheduler attempt/request 无法由 execution scope 复算。',
      ));
    }
    const scopeDigest = storeCollectionSchedulerRecoveryAdmissionScopeDigest({
      executionScope,
      context,
      attemptId: identity.attemptId,
      requestId: identity.requestId,
    });
    const receipt = await this.dependencies.registerSchedulerRecoveryAdmission({
      ...auth,
      executionScope,
      context,
      attemptId: identity.attemptId,
      requestId: identity.requestId,
    });
    this.assertCapabilityBound(receipt, auth);
    if (!receipt
      || receipt.registered !== true
      || !runtimeCapability(receipt.recoveryAdmission)
      || receipt.executionScope !== executionScope
      || receipt.context !== context
      || receipt.attemptId !== identity.attemptId
      || receipt.requestId !== identity.requestId
      || receipt.scopeDigest !== scopeDigest) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'recovery admission 回执未绑定 verified history execution scope/attempt/request。',
      ));
    }
    this.registerCapabilityIdentity(receipt.recoveryAdmission, {
      domain: 'recovery_admission',
      lifecycle: 'active',
      owner: auth.owner,
      cycleId: verified.cycleId,
      transitionId: verified.transitionId,
    });
    return {
      recoveryAdmission: receipt.recoveryAdmission,
      executionScope,
      context,
      attemptId: identity.attemptId,
      requestId: identity.requestId,
      scopeDigest,
    };
  }

export async function recoverPendingTransitions(this: StoreCollectionOrchestratorRuntime,
  input: {
    transitions: readonly StoreCollectionOrchestratorTransition[];
    auth: StoreCollectionAutomationAuthority;
    policyGuard: StoreCollectionPolicySuppressionGuard;
  }): Promise<PendingTransitionRecoveryPlan[]> {
    const plans: PendingTransitionRecoveryPlan[] = [];
    for (const original of input.transitions) {
      if (!isSchedulerBoundPendingTransition(original)) {
        plans.push({ transition: original, disposition: 'interrupt' });
        continue;
      }
      let transition = original;
      let transitionAuthority: StoreCollectionRecoveryAutomationAuthority | undefined;
      try {
        const context = contextFromTransition(transition);
        const recoveryAdmission = await this.registerProtectedSchedulerRecoveryAdmission(
          transition,
          input.auth,
        );
        transitionAuthority = await this.deriveTransitionAuthority(
          transition,
          input.auth,
          input.policyGuard,
          'recovery_existing_request_only',
          recoveryAdmission,
        );
        const projection = await this.dependencies.scheduler.recover({
          ...transitionAuthority,
          context,
          expectedAuthority: { activeStoreId: context.storeId, context },
          cycleId: transition.cycleId,
          transitionId: transition.transitionId,
          expectedFingerprint: transition.expectedFingerprint!,
          attemptId: transition.schedulerAttemptId!,
          requestId: transition.schedulerRequestId!,
        });
        const recoveredState = this.validateSchedulerRecovery(projection, {
          auth: transitionAuthority,
          executionIdentityScope: freezeTransitionScope(
            transitionScopeFromTransition(transition, 'transition_execution'),
          ),
          context,
          cycleId: transition.cycleId,
          transitionId: transition.transitionId,
          expectedFingerprint: transition.expectedFingerprint!,
        });
        if (recoveredState === 'succeeded') {
          if (transition.phase === 'scheduler_request_bound') {
            transition = this.updateTransition(transition, { phase: 'scheduler_accepted' });
          }
          if (transition.phase === 'scheduler_accepted') {
            transition = this.updateTransition(transition, { phase: 'scheduler_reconciled' });
          }
          plans.push({
            transition,
            disposition: 'scheduler_succeeded',
            transitionAuthority,
          });
          continue;
        }
        if (recoveredState === 'failed'
          && (transition.phase === 'scheduler_request_bound'
            || transition.phase === 'scheduler_accepted')) {
          plans.push({
            transition,
            disposition: 'scheduler_failed',
            transitionAuthority,
          });
          continue;
        }
        if (recoveredState === 'accepted' && transition.phase === 'scheduler_request_bound') {
          transition = this.updateTransition(transition, { phase: 'scheduler_accepted' });
        }
        if (recoveredState === 'not_found' && transition.phase === 'scheduler_request_bound') {
          // 首次外部操作前已持久化任务；精确请求缺失只能终结尚未受理的尝试。
          plans.push({
            transition,
            disposition: 'scheduler_not_created',
            transitionAuthority,
          });
          continue;
        }
        plans.push({
          transition,
          disposition: 'scheduler_unresolved',
          transitionAuthority,
          error: new StoreCollectionOrchestratorError(
            'SAFETY_STATE_UNKNOWN',
            'scheduler recover 尚未证明原 durable request 的 succeeded/failed 终态。',
          ),
        });
      } catch (error) {
        plans.push({
          transition,
          disposition: 'scheduler_unresolved',
          ...(transitionAuthority ? { transitionAuthority } : {}),
          error,
        });
      }
    }
    return plans;
  }

export function finalizeRecoveredSchedulerTransition(this: StoreCollectionOrchestratorRuntime,
  plan: PendingTransitionRecoveryPlan,
  succeeded: boolean,
  failedCode: Extract<StoreCollectionOrchestratorFailureCode,
      'SCHEDULER_FAILED' | 'SCHEDULER_NOT_SUCCEEDED'> = 'SCHEDULER_FAILED'): StoreCollectionOrchestratorOutcome {
    let transition = plan.transition;
    try {
      if (succeeded && transition.phase === 'scheduler_reconciled') {
        transition = this.updateTransition(transition, { phase: 'cleanup_pending' });
      }
      const completedAt = this.now().toISOString();
      const terminalPhase: TransitionPhase = succeeded ? 'completed' : 'failed';
      const failureCode = succeeded ? undefined : failedCode;
      const result = this.completeCollectionTransition(transition, {
        phase: terminalPhase,
        completedAt,
        ...(failureCode ? { failureCode } : {}),
      }, {
        outcomeId: randomUUID(),
        cycleId: transition.cycleId,
        transitionId: transition.transitionId,
        owner: transition.owner,
        storeId: transition.toStoreId!,
        browserProfileId: transition.browserProfileId!,
        businessDate: transition.businessDate!,
        sessionGeneration: transition.sessionGeneration!,
        fingerprint: transition.expectedFingerprint!,
        attemptId: transition.schedulerAttemptId!,
        requestId: transition.schedulerRequestId!,
        schedulerSucceeded: succeeded,
        cleanupStatus: 'confirmed',
        state: succeeded ? 'succeeded' : 'failed',
        startedAt: transition.startedAt,
        completedAt,
        ...(failureCode ? { failureCode } : {}),
      });
      if (plan.transitionAuthority) {
        this.setCapabilityLifecycle(
          plan.transitionAuthority.transitionCapability,
          'transition_recovery',
          'retired',
        );
      }
      return result.outcome;
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
  }

export function commonRecoveryOrigin(this: StoreCollectionOrchestratorRuntime,
  transitions: readonly StoreCollectionOrchestratorTransition[]): StoreCollectionAuthorityReadback {
    const [first, ...rest] = transitions;
    if (!first || rest.some((transition) => !sameAuthority(transition.originAuthority, first.originAuthority))) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '非终态切换记录缺少唯一 durable operator origin。',
      ));
    }
    return cloneAuthorityReadback(first.originAuthority);
  }
