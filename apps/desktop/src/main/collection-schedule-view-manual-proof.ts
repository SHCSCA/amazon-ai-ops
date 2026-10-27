import type {
  StoreCollectionScheduleProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  type ManualCycleReadback,
  type ManualCycleOutcomeReadback,
} from "./collection-schedule-view-contracts";
import {
  assertUsContext,
} from "./collection-schedule-view-identity-proof";

export function assertManualRunScopeUnchanged(
  before: StoreCollectionScheduleProjection,
  after: StoreCollectionScheduleProjection,
): void {
  if (before.storeId !== after.storeId
    || before.businessDate !== after.businessDate
    || before.enabled !== after.enabled
    || before.scheduleLocalTime !== after.scheduleLocalTime
    || before.configRevision !== after.configRevision
    || before.dateStart !== after.dateStart
    || before.dateEnd !== after.dateEnd
    || before.fingerprint !== after.fingerprint) {
    throw new Error('manual run scope changed before exact result readback');
  }
}

export function assertPostRunAuthority(
  requested: StoreContextEnvelope,
  current: StoreContextEnvelope,
): void {
  if (current.storeId !== requested.storeId
    || current.browserProfileId !== requested.browserProfileId
    || current.marketplace !== requested.marketplace
    || current.currency !== requested.currency
    || current.businessTimezone !== requested.businessTimezone
    || current.businessDate !== requested.businessDate
    || !Number.isSafeInteger(current.sessionGeneration)
    || current.sessionGeneration < requested.sessionGeneration) {
    throw new Error('Main active authority changed during manual run');
  }
  assertUsContext(current);
}

export function inspectManualCycle(
  value: unknown,
  requested: StoreContextEnvelope,
): ManualCycleReadback {
  const cycle = asRecord(value);
  if (cycle.state !== 'completed'
    || typeof cycle.cycleId !== 'string'
    || cycle.cycleId.trim().length === 0) {
    throw manualCycleAmbiguous();
  }
  const skipped = readStoreIds(cycle.skippedStoreIds);
  const planned = readStoreIds(cycle.plannedDueStoreIds);
  const attempted = readStoreIds(cycle.attemptedStoreIds);
  const outcomes = Array.isArray(cycle.outcomes) ? cycle.outcomes : null;
  if (!outcomes
    || [...skipped, ...planned, ...attempted].some((storeId) => storeId !== requested.storeId)) {
    throw manualCycleAmbiguous();
  }
  const exactSkipped = skipped.length === 1
    && planned.length === 0
    && attempted.length === 0;
  const exactAttempted = skipped.length === 0
    && planned.length === 1
    && attempted.length === 1;
  if (exactSkipped) {
    if (outcomes.length !== 0) throw manualCycleAmbiguous();
    return { disposition: 'skipped' };
  }
  if (!exactAttempted || outcomes.length !== 1) throw manualCycleAmbiguous();
  const rawOutcome = asRecord(outcomes[0]);
  const state = rawOutcome.state;
  const requestId = rawOutcome.requestId;
  const failureCode = rawOutcome.failureCode;
  if (rawOutcome.storeId !== requested.storeId
    || rawOutcome.browserProfileId !== requested.browserProfileId
    || rawOutcome.businessDate !== requested.businessDate
    || typeof rawOutcome.fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(rawOutcome.fingerprint)
    || !['succeeded', 'blocked', 'failed'].includes(String(state))
    || (requestId !== undefined && (typeof requestId !== 'string' || requestId.trim().length === 0))
    || (failureCode !== undefined && typeof failureCode !== 'string')) {
    throw manualCycleAmbiguous();
  }
  return {
    disposition: 'attempted',
    outcome: {
      storeId: requested.storeId,
      browserProfileId: requested.browserProfileId,
      businessDate: requested.businessDate,
      fingerprint: rawOutcome.fingerprint,
      state: state as ManualCycleOutcomeReadback['state'],
      ...(requestId === undefined ? {} : { requestId }),
      ...(failureCode === undefined ? {} : { failureCode }),
    },
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw manualCycleAmbiguous();
  }
  return value as Record<string, unknown>;
}

export function readStoreIds(value: unknown): string[] {
  if (!Array.isArray(value)
    || value.some((item) => typeof item !== 'string' || item.trim().length === 0)
    || new Set(value).size !== value.length) {
    throw manualCycleAmbiguous();
  }
  return value as string[];
}

export function manualCycleAmbiguous(): Error {
  return new Error('manual cycle result is unrelated or ambiguous');
}

export function isPreSchedulerIdentityFailure(value: unknown): boolean {
  return typeof value === 'string'
    && ['LOGIN_REQUIRED', 'REAUTH_REQUIRED', 'MFA_REQUIRED', 'IDENTITY_UNVERIFIED'].includes(value);
}
