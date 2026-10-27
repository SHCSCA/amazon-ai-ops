import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
  type StoreId,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionAutomationAuthority,
  type StoreCollectionAuthorityReadback,
  StoreCollectionOrchestratorError,
  type StoreCollectionExecutionAutomationAuthority,
  type StoreCollectionTransitionReceipt,
  type StoreCollectionTransitionTarget,
  type AuthorityBoundConfirmation,
  type StoreCollectionTransitionCapabilityDomain,
  type StoreCollectionTransitionAutomationAuthority,
} from "./collection-orchestrator-contracts";
import {
  cloneAuthorityReadback,
  sameAuthority,
  authorityMatchesRestoreTarget,
  authorityMatchesTransitionTarget,
  transitionTargetFromContext,
  sameTransitionTarget,
  capabilityIdentityDomain,
} from "./collection-orchestrator-authority-values";
import {
  codepointCompare,
} from "./collection-orchestrator-failure-values";

import type { StoreCollectionOrchestratorRuntime } from './collection-orchestrator-runtime';

export async function readAuthority(this: StoreCollectionOrchestratorRuntime,
  auth: StoreCollectionAutomationAuthority): Promise<StoreCollectionAuthorityReadback> {
    try {
      const confirmation = await this.dependencies.readActiveAuthority(auth);
      this.assertCapabilityBound(confirmation, auth);
      this.assertAuthority(confirmation.authority);
      return cloneAuthorityReadback(confirmation.authority);
    } catch {
      throw this.markSafetyUnknown(
        new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'Main authority 回读失败。'),
      );
    }
  }

export async function readTransitionAuthority(this: StoreCollectionOrchestratorRuntime,
  auth: StoreCollectionExecutionAutomationAuthority,
  expectedAuthority: StoreCollectionAuthorityReadback): Promise<StoreCollectionAuthorityReadback> {
    this.assertAuthorityWithinTransitionScope(auth, expectedAuthority);
    try {
      const confirmation = await this.dependencies.readTransitionAuthority({
        ...auth,
        expectedAuthority: cloneAuthorityReadback(expectedAuthority),
      });
      this.assertTransitionCapabilityBound(confirmation, auth);
      this.assertAuthorityExact(confirmation.authority, expectedAuthority);
      return cloneAuthorityReadback(confirmation.authority);
    } catch {
      throw this.markSafetyUnknown(
        new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'Main transition-scoped authority 回读失败。',
        ),
      );
    }
  }

export function assertAuthorityWithinTransitionScope(this: StoreCollectionOrchestratorRuntime,
  auth: StoreCollectionExecutionAutomationAuthority,
  authority: StoreCollectionAuthorityReadback): void {
    this.assertAuthority(authority);
    const scope = auth.transitionScope;
    const allowed = sameAuthority(authority, scope.fromAuthority)
      || authorityMatchesRestoreTarget(authority, scope.originAuthority)
      || authorityMatchesTransitionTarget(authority, scope.target);
    if (!allowed) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'authority 不在当前 transition capability 的 Store/Profile/Generation scope 内。',
      ));
    }
  }

export function validateTransitionReceipt(this: StoreCollectionOrchestratorRuntime,
  receipt: StoreCollectionTransitionReceipt,
  input: {
      auth: StoreCollectionExecutionAutomationAuthority;
      expectedPrevious: StoreCollectionAuthorityReadback;
      target: StoreCollectionTransitionTarget | null;
      minimumTargetAuthority?: StoreCollectionAuthorityReadback;
    }): StoreContextEnvelope | null {
    this.assertAuthorityWithinTransitionScope(input.auth, input.expectedPrevious);
    const recoveryTarget = input.auth.transitionScope.originAuthority.context
      ? transitionTargetFromContext(input.auth.transitionScope.originAuthority.context)
      : null;
    if (!sameTransitionTarget(input.target, input.auth.transitionScope.target)
      && !sameTransitionTarget(input.target, recoveryTarget)) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '切店目标不在当前 transition capability scope 内。',
      ));
    }
    if (!receipt
      || receipt.reason !== 'collection_automation'
      || receipt.mode !== 'collection_only') {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '切店回执缺少 collection-only 模式证明。',
      ));
    }
    this.assertTransitionCapabilityBound(receipt, input.auth);
    this.assertAuthorityExact(receipt.previous, input.expectedPrevious);
    if (input.target === null) {
      if (receipt.current.activeStoreId !== null
        || receipt.current.context !== null
        || receipt.targetGenerationBefore !== null
        || receipt.targetGenerationAfter !== null) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          '空 authority 恢复回执无效。',
        ));
      }
      return null;
    }
    if (!Number.isInteger(receipt.targetGenerationBefore)
      || !Number.isInteger(receipt.targetGenerationAfter)
      || (receipt.targetGenerationAfter ?? -1) <= (receipt.targetGenerationBefore ?? -1)) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '切店回执缺少 generation 单调递增证明。',
      ));
    }
    this.assertAuthority(receipt.current, input.target.storeId);
    if (!receipt.current.context) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '切店回执缺少目标 StoreContext。',
      ));
    }
    const context = normalizeStoreContextEnvelope(receipt.current.context);
    if (context.storeId !== input.target.storeId
      || context.browserProfileId !== input.target.browserProfileId
      || context.marketplace !== 'US'
      || context.currency !== 'USD'
      || context.businessTimezone !== 'America/Los_Angeles'
      || context.sessionGeneration !== receipt.targetGenerationAfter) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '切店回执与目标店铺或 generation 不一致。',
      ));
    }
    if (input.expectedPrevious.context) {
      const previousContext = normalizeStoreContextEnvelope(input.expectedPrevious.context);
      if (previousContext.storeId === context.storeId
        && previousContext.browserProfileId === context.browserProfileId
        && (
          receipt.targetGenerationBefore !== previousContext.sessionGeneration
          || context.sessionGeneration <= previousContext.sessionGeneration
          || codepointCompare(context.businessDate, previousContext.businessDate) < 0
        )) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'same Store/Profile transition 未证明 previous generation/date 的严格单调推进。',
        ));
      }
    }
    if (input.minimumTargetAuthority) {
      const durableTarget = input.minimumTargetAuthority;
      if (durableTarget.activeStoreId !== input.target.storeId
        || !durableTarget.context) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'durable restore origin 与目标 StoreContext 不一致。',
        ));
      }
      const durableContext = normalizeStoreContextEnvelope(durableTarget.context);
      if (durableContext.storeId !== context.storeId
        || durableContext.browserProfileId !== context.browserProfileId
        || durableContext.marketplace !== 'US'
        || durableContext.currency !== 'USD'
        || durableContext.businessTimezone !== 'America/Los_Angeles'
        || (receipt.targetGenerationBefore ?? -1) < durableContext.sessionGeneration
        || context.sessionGeneration <= durableContext.sessionGeneration
        || codepointCompare(context.businessDate, durableContext.businessDate) < 0) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
          'SAFETY_STATE_UNKNOWN',
          'restore 回执未证明完整 US/USD/LA context、日期单调性或 durable generation 递增。',
        ));
      }
    }
    return context;
  }

export function validateConfirmation(this: StoreCollectionOrchestratorRuntime,
  confirmation: AuthorityBoundConfirmation & Partial<Record<'started' | 'verified', true>>,
  auth: StoreCollectionExecutionAutomationAuthority,
  expectedAuthority: StoreCollectionAuthorityReadback,
  flag: 'started' | 'verified'): void {
    if (!confirmation || confirmation[flag] !== true) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '可见采集阶段回执缺少当前 capability 证明。',
      ));
    }
    this.assertTransitionCapabilityBound(confirmation, auth);
    this.assertAuthorityExact(confirmation.authority, expectedAuthority);
  }

export function assertAuthority(this: StoreCollectionOrchestratorRuntime,
  value: StoreCollectionAuthorityReadback | undefined,
  expectedStoreId?: StoreId | null): void {
    if (!value || (value.activeStoreId !== null && typeof value.activeStoreId !== 'string')) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 回读无效。'));
    }
    if (value.activeStoreId === null) {
      if (value.context !== null) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 空店铺仍携带上下文。'));
      }
    } else {
      if (!value.context) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 缺少活动上下文。'));
      }
      let context: StoreContextEnvelope;
      try {
        context = normalizeStoreContextEnvelope(value.context);
      } catch {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 上下文无效。'));
      }
      if (context.storeId !== value.activeStoreId) {
        throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 店铺与上下文不一致。'));
      }
    }
    if (expectedStoreId !== undefined && value.activeStoreId !== expectedStoreId) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError('SAFETY_STATE_UNKNOWN', 'authority 活动店铺与预期不一致。'));
    }
  }

export function assertAuthorityExact(this: StoreCollectionOrchestratorRuntime,
  actual: StoreCollectionAuthorityReadback,
  expected: StoreCollectionAuthorityReadback): void {
    this.assertAuthority(actual);
    this.assertAuthority(expected);
    if (!sameAuthority(actual, expected)) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'capability-bound authority 的 Store/Profile/Generation 上下文不一致。',
      ));
    }
  }

export function assertCapabilityBound(this: StoreCollectionOrchestratorRuntime,
  value: StoreCollectionAutomationAuthority | undefined,
  auth: StoreCollectionAutomationAuthority): void {
    this.assertCapabilityIdentity(auth.capability, 'automation', 'active');
    if (!value || value.owner !== auth.owner || value.capability !== auth.capability) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '阶段回执未绑定当前不可重放 automation capability。',
      ));
    }
  }

export function assertTransitionCapabilityBound<Domain extends StoreCollectionTransitionCapabilityDomain>(this: StoreCollectionOrchestratorRuntime,
  value: StoreCollectionTransitionAutomationAuthority<Domain> | undefined,
  auth: StoreCollectionTransitionAutomationAuthority<Domain>): void {
    this.assertCapabilityBound(value, auth);
    this.assertCapabilityIdentity(
      auth.transitionCapability,
      capabilityIdentityDomain(auth.transitionScope.capabilityDomain),
      'active',
    );
    if (!value
      || value.transitionCapability !== auth.transitionCapability
      || value.transitionScope !== auth.transitionScope) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        '阶段回执未绑定当前 transition capability 与完整 scope。',
      ));
    }
  }
