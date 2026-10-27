import {
  type StoreCollectionExecutionAutomationAuthority,
  type StoreCollectionVisibleRuntimeIntent,
  StoreCollectionOrchestratorError,
  type CapabilityIdentityRecord,
  type CapabilityIdentityDomain,
  type CapabilityIdentityLifecycle,
  type StoreCollectionTransitionCapabilityDomain,
  type StoreCollectionOrchestratorTransition,
  type StoreCollectionAutomationAuthority,
  type StoreCollectionPolicySuppressionGuard,
  type ProtectedSchedulerRecoveryAdmission,
  type StoreCollectionTransitionAutomationAuthority,
  type StoreCollectionTransitionCapabilityReceipt,
  type StoreCollectionAutomationLease,
  type StoreCollectionPolicySuppressionLease,
} from "./collection-orchestrator-contracts";
import {
  runtimeCapability,
  freezeTransitionScope,
  transitionScopeFromTransition,
  capabilityIdentityDomain,
  assertAutomationLease,
  assertPolicySuppressionLease,
} from "./collection-orchestrator-authority-values";

import type { StoreCollectionOrchestratorRuntime } from './collection-orchestrator-runtime';

export function visibleRuntimeIntent(this: StoreCollectionOrchestratorRuntime,
  auth: StoreCollectionExecutionAutomationAuthority,
  intent: 'initial' | 'terminal_cleanup'): StoreCollectionVisibleRuntimeIntent {
    let record = this.visibleRuntimeIntents.get(auth.transitionCapability);
    if (!record) {
      if (intent !== 'initial') {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'visible runtime terminal cleanup intent was requested before initial intent issuance.',
        ));
      }
      const domainCapability = Object.freeze({});
      const initialCapability = Object.freeze({});
      const terminalCleanupCapability = Object.freeze({});
      record = Object.freeze({
        initial: Object.freeze({
          domainCapability,
          initialCapability,
          terminalCleanupCapability,
          selectedCapability: initialCapability,
        }) as StoreCollectionVisibleRuntimeIntent,
        terminalCleanup: Object.freeze({
          domainCapability,
          initialCapability,
          terminalCleanupCapability,
          selectedCapability: terminalCleanupCapability,
        }) as StoreCollectionVisibleRuntimeIntent,
      });
      this.visibleRuntimeIntents.set(auth.transitionCapability, record);
    }
    return intent === 'initial' ? record.initial : record.terminalCleanup;
  }

export function registerCapabilityIdentity(this: StoreCollectionOrchestratorRuntime,
  value: Readonly<object>,
  record: CapabilityIdentityRecord): void {
    if (this.capabilityIdentityRegistry.has(value)) {
      throw new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'Main 重用了 capability 对象或把同一对象签发到不同 authority domain。',
      );
    }
    this.capabilityIdentityRegistry.set(value, { ...record });
  }

export function hasRegisteredCapabilityIdentity(this: StoreCollectionOrchestratorRuntime,
  value: unknown): boolean {
    return runtimeCapability(value) && this.capabilityIdentityRegistry.has(value);
  }

export function assertCapabilityIdentity(this: StoreCollectionOrchestratorRuntime,
  value: Readonly<object>,
  domain: CapabilityIdentityDomain,
  lifecycle: CapabilityIdentityLifecycle): void {
    const record = this.capabilityIdentityRegistry.get(value);
    if (!record || record.domain !== domain || record.lifecycle !== lifecycle) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        `capability identity 未绑定 active ${domain} lifecycle。`,
      ));
    }
  }

export function setCapabilityLifecycle(this: StoreCollectionOrchestratorRuntime,
  value: Readonly<object>,
  domain: CapabilityIdentityDomain,
  lifecycle: CapabilityIdentityLifecycle): void {
    const record = this.capabilityIdentityRegistry.get(value);
    if (!record || record.domain !== domain || record.lifecycle !== 'active') {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        `capability identity 无法进入 ${lifecycle} lifecycle。`,
      ));
    }
    this.capabilityIdentityRegistry.set(value, { ...record, lifecycle });
  }

export async function deriveTransitionAuthority<Domain extends StoreCollectionTransitionCapabilityDomain>(this: StoreCollectionOrchestratorRuntime,
  transition: StoreCollectionOrchestratorTransition,
  auth: StoreCollectionAutomationAuthority,
  policyGuard: StoreCollectionPolicySuppressionGuard,
  capabilityDomain: Domain,
  recoveryAdmission?: ProtectedSchedulerRecoveryAdmission): Promise<StoreCollectionTransitionAutomationAuthority<Domain>> {
    const scope = freezeTransitionScope(transitionScopeFromTransition(transition, capabilityDomain));
    let receipt: StoreCollectionTransitionCapabilityReceipt<Domain>;
    try {
      if ((capabilityDomain === 'recovery_existing_request_only') !== Boolean(recoveryAdmission)) {
        throw new Error('recovery transition capability requires one protected-history admission');
      }
      receipt = await this.dependencies.deriveTransitionCapability({
        ...auth,
        scope,
        ...(recoveryAdmission ? {
          recoveryAdmission: recoveryAdmission.recoveryAdmission,
          recoveryScopeDigest: recoveryAdmission.scopeDigest,
          schedulerAttemptId: recoveryAdmission.attemptId,
          schedulerRequestId: recoveryAdmission.requestId,
        } : {}),
      });
      if (!receipt || receipt.derived !== true || !runtimeCapability(receipt.transitionCapability)) {
        throw new Error('invalid transition capability receipt');
      }
      this.assertCapabilityBound(receipt, auth);
      if (receipt.transitionScope !== scope
        || this.issuedTransitionCapabilityIds.has(scope.capabilityId)) {
        throw new Error('replayed, aliased, or scope-mismatched transition capability');
      }
      if (recoveryAdmission) {
        this.assertCapabilityIdentity(
          recoveryAdmission.recoveryAdmission,
          'recovery_admission',
          'active',
        );
        if (receipt.recoveryAdmission !== recoveryAdmission.recoveryAdmission
          || receipt.recoveryScopeDigest !== recoveryAdmission.scopeDigest
          || receipt.schedulerAttemptId !== recoveryAdmission.attemptId
          || receipt.schedulerRequestId !== recoveryAdmission.requestId) {
          throw new Error('recovery capability receipt did not consume the exact protected-history admission');
        }
      } else if (receipt.recoveryAdmission !== undefined
        || receipt.recoveryScopeDigest !== undefined
        || receipt.schedulerAttemptId !== undefined
        || receipt.schedulerRequestId !== undefined) {
        throw new Error('execution capability receipt carried an unauthorized recovery admission');
      }
      this.registerCapabilityIdentity(receipt.transitionCapability, {
        domain: capabilityIdentityDomain(capabilityDomain),
        lifecycle: 'active',
        owner: auth.owner,
        cycleId: transition.cycleId,
        transitionId: transition.transitionId,
      });
      this.assertCapabilityIdentity(policyGuard, 'policy', 'active');
      this.issuedTransitionCapabilityIds.add(scope.capabilityId);
      if (recoveryAdmission) {
        this.setCapabilityLifecycle(
          recoveryAdmission.recoveryAdmission,
          'recovery_admission',
          'retired',
        );
      }
      return {
        ...auth,
        transitionCapability: receipt.transitionCapability,
        transitionScope: scope,
      };
    } catch (error) {
      throw this.markSafetyUnknown(error);
    }
  }

export function assertFreshAutomationLease(this: StoreCollectionOrchestratorRuntime,
  value: StoreCollectionAutomationLease,
  cycleId: string): void {
    assertAutomationLease(value);
    this.registerCapabilityIdentity(value.capability, {
      domain: 'automation',
      lifecycle: 'active',
      owner: value.owner,
      cycleId,
    });
  }

export async function releaseMalformedAutomationLease(this: StoreCollectionOrchestratorRuntime,
  value: unknown): Promise<void> {
    if (!value || typeof value !== 'object' || typeof (value as { release?: unknown }).release !== 'function') return;
    try {
      await (value as { release(): Promise<unknown> }).release();
    } catch {
      // 无论尽力释放是否成功，调用方都必须标记状态未知。
    }
  }

export async function releaseAutomationLease(this: StoreCollectionOrchestratorRuntime,
  lease: StoreCollectionAutomationLease,
  auth: StoreCollectionAutomationAuthority): Promise<void> {
    const receipt = await lease.release();
    if (!receipt || receipt.released !== true) throw new Error('automation lease release not proven');
    this.assertCapabilityBound(receipt, auth);
    this.setCapabilityLifecycle(auth.capability, 'automation', 'released');
  }

export async function acquirePolicySuppression(this: StoreCollectionOrchestratorRuntime,
  auth: StoreCollectionAutomationAuthority,
  cycleId: string): Promise<StoreCollectionPolicySuppressionLease> {
    let acquired: StoreCollectionPolicySuppressionLease;
    try {
      acquired = await this.dependencies.acquirePolicyDispatchSuppression(auth);
    } catch {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '无法获得独立 policy dispatch suppression guard。',
      ));
    }
    try {
      assertPolicySuppressionLease(acquired);
      this.assertCapabilityBound(acquired, auth);
      this.registerCapabilityIdentity(acquired.guard, {
        domain: 'policy',
        lifecycle: 'active',
        owner: auth.owner,
        cycleId,
      });
      return acquired;
    } catch (error) {
      // 无法证明能力新鲜且跨域独立时保持抑制，避免误释放未知所有权。
      throw this.markSafetyUnknown(error);
    }
  }

export async function assertPolicySuppressed(this: StoreCollectionOrchestratorRuntime,
  auth: StoreCollectionAutomationAuthority,
  guard: StoreCollectionPolicySuppressionGuard): Promise<void> {
    this.assertCapabilityIdentity(guard, 'policy', 'active');
    try {
      const receipt = await this.dependencies.readPolicyDispatchSuppression({ ...auth, guard });
      if (!receipt || receipt.suppressed !== true || receipt.guard !== guard) {
        throw new Error('invalid policy suppression proof');
      }
      this.assertCapabilityBound(receipt, auth);
    } catch (error) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '独立 policy guard 未证明 dispatch 持续被抑制。',
      ));
    }
  }

export async function releasePolicySuppression(this: StoreCollectionOrchestratorRuntime,
  lease: StoreCollectionPolicySuppressionLease,
  auth: StoreCollectionAutomationAuthority): Promise<void> {
    this.assertCapabilityIdentity(lease.guard, 'policy', 'active');
    const receipt = await lease.release();
    if (!receipt || receipt.released !== true || receipt.guard !== lease.guard) {
      throw new Error('policy suppression release not proven');
    }
    this.assertCapabilityBound(receipt, auth);
    this.setCapabilityLifecycle(lease.guard, 'policy', 'released');
  }
