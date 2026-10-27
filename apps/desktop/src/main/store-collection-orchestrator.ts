import {
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionProtectedSemanticAttemptQuery,
  type StoreCollectionProtectedSemanticAttemptReadback,
  type StoreCollectionOrchestratorCycleResult,
  type StoreCollectionOrchestratorTransition,
} from "./collection-orchestrator-contracts";

import { StoreCollectionOrchestratorRuntime } from './collection-orchestrator-runtime';

export {
  STORE_COLLECTION_MAX_DAILY_SEMANTIC_ATTEMPTS_PER_STORE_PROFILE,
  STORE_COLLECTION_TRANSITION_PHASES,
} from "./collection-orchestrator-constants";
export {
  type StoreCollectionAutomationCapability,
  type StoreCollectionTransitionCapability,
  type StoreCollectionVisibleRuntimeIntent,
  type StoreCollectionSchedulerRecoveryAdmission,
  type StoreCollectionPolicySuppressionGuard,
  type StoreCollectionAutomationAuthority,
  type StoreCollectionTransitionCapabilityDomain,
  type StoreCollectionTransitionCapabilityScope,
  type StoreCollectionTransitionAutomationAuthority,
  type StoreCollectionExecutionAutomationAuthority,
  type StoreCollectionRecoveryAutomationAuthority,
  type StoreCollectionTransitionCapabilityReceipt,
  type StoreCollectionSchedulerRecoveryAdmissionReceipt,
  type StoreCollectionAutomationLease,
  type StoreCollectionAutomationLeaseReleaseReceipt,
  type StoreCollectionPolicySuppressionLease,
  type StoreCollectionPolicySuppressionReceipt,
  type StoreCollectionPolicySuppressionReleaseReceipt,
  type StoreCollectionAuthorityReadback,
  type StoreCollectionAuthorityConfirmation,
  type StoreCollectionTransitionAuthorityConfirmation,
  type StoreCollectionTransitionTarget,
  type StoreCollectionTransitionReceipt,
  type StoreCollectionOrchestratorFailureCode,
  type StoreCollectionOrchestratorTransitionPurpose,
  type StoreCollectionOrchestratorTransitionPhase,
  type StoreCollectionScheduleInspection,
  type StoreCollectionManualScheduleInspection,
  type StoreCollectionOrchestratorSchedulerState,
  type StoreCollectionOrchestratorSchedulerProjection,
  type StoreCollectionSchedulerExecutionIdentityInput,
  type StoreCollectionSchedulerExecutionIdentity,
  type StoreCollectionOrchestratorTransition,
  type StoreCollectionOrchestratorOutcome,
  type StoreCollectionSemanticAttempt,
  type StoreCollectionProtectedSemanticAttemptQuery,
  type StoreCollectionProtectedSemanticAttemptReadback,
  type StoreCollectionOrchestratorHistoryPort,
  type StoreCollectionOrchestratorRecordCodec,
  type StoreCollectionOrchestratorDependencies,
  type StoreCollectionOrchestratorCycleResult,
  StoreCollectionOrchestratorError,
} from "./collection-orchestrator-contracts";
export {
  storeCollectionOrchestratorTransitionIntegrityDigest,
  storeCollectionOrchestratorOutcomeIntegrityDigest,
  deriveStoreCollectionSchedulerExecutionIdentity,
  storeCollectionSchedulerRecoveryAdmissionScopeDigest,
} from "./collection-orchestrator-integrity";
export {
  storeCollectionTransitionPhaseFieldsValid,
} from "./collection-orchestrator-history-validation";
export {
  isStoreCollectionTransitionPhaseAllowed,
} from "./collection-orchestrator-failure-values";

export class StoreCollectionOrchestrator {
  private readonly runtime: StoreCollectionOrchestratorRuntime;

  constructor(private readonly dependencies: StoreCollectionOrchestratorDependencies) {
    this.runtime = new StoreCollectionOrchestratorRuntime(dependencies);
  }

  start(): void {
    return this.runtime.start();
  }

  stop(): void {
    return this.runtime.stop();
  }

  stopAndDrain(timeoutMs = 5_000): Promise<void> {
    return this.runtime.stopAndDrain(timeoutMs);
  }

  isTransitionLocked(): boolean {
    return this.runtime.isTransitionLocked();
  }

  assertUserOperationAllowed(): void {
    return this.runtime.assertUserOperationAllowed();
  }

  readProtectedSemanticAttempt(
    input: StoreCollectionProtectedSemanticAttemptQuery,
  ): Readonly<StoreCollectionProtectedSemanticAttemptReadback> | null {
    return this.runtime.readProtectedSemanticAttempt(input);
  }

  runCycle(): Promise<StoreCollectionOrchestratorCycleResult> {
    return this.runtime.runCycle();
  }

  recoverExistingTransitionsOnly(): Promise<StoreCollectionOrchestratorCycleResult> {
    return this.runtime.recoverExistingTransitionsOnly();
  }

  runStoreNow(value: StoreContextEnvelope): Promise<StoreCollectionOrchestratorCycleResult> {
    return this.runtime.runStoreNow(value);
  }

  private updateTransition(
    transition: StoreCollectionOrchestratorTransition,
    patch: Omit<Partial<StoreCollectionOrchestratorTransition>, 'integrityDigest' | 'transitionId' | 'cycleId'
      | 'capabilityId' | 'owner' | 'fromStoreId' | 'toStoreId' | 'browserProfileId' | 'purpose'
      | 'fromAuthority' | 'originAuthority'
      | 'expectedFingerprint' | 'startedAt'>,
  ): StoreCollectionOrchestratorTransition {
    return this.runtime.updateTransition(transition, patch);
  }
}
