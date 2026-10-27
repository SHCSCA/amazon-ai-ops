import {
  normalizeStoreContextEnvelope,
  type BrowserProfileId,
  type StoreContextEnvelope,
  type StoreId,
  type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  type StoreCollectionAuthorityReadback,
  StoreCollectionOrchestratorError,
  type StoreCollectionManualScheduleInspection,
  type StoreCollectionScheduleInspection,
} from "./collection-orchestrator-contracts";
import {
  cloneStoreRecord,
  sameAuthority,
  collectionAttemptSemanticKey,
} from "./collection-orchestrator-authority-values";
import {
  codepointCompare,
  validFingerprint,
} from "./collection-orchestrator-failure-values";

import type { StoreCollectionOrchestratorRuntime } from './collection-orchestrator-runtime';

export function assertAuthorityAgainstActiveStoreSnapshot(this: StoreCollectionOrchestratorRuntime,
  authority: StoreCollectionAuthorityReadback,
  activeStores: readonly StoreRecord[]): void {
    this.assertAuthority(authority);
    if (authority.activeStoreId === null) return;
    const context = normalizeStoreContextEnvelope(authority.context!);
    const exactStore = activeStores.find((store) => (
      store.storeId === authority.activeStoreId
      && store.browserProfileId === context.browserProfileId
    ));
    if (!exactStore
      || context.storeId !== authority.activeStoreId
      || context.marketplace !== 'US'
      || context.currency !== 'USD'
      || context.businessTimezone !== 'America/Los_Angeles'
      || exactStore.marketplace !== context.marketplace
      || exactStore.currency !== context.currency
      || exactStore.businessTimezone !== context.businessTimezone) {
      throw this.markSafetyUnknown(new StoreCollectionOrchestratorError(
        'SAFETY_STATE_UNKNOWN',
        'authority 未与 activeStores 的 US/USD/America/Los_Angeles Store/Profile snapshot 精确绑定。',
      ));
    }
  }

export function stableActiveStoreSnapshot(this: StoreCollectionOrchestratorRuntime): StoreRecord[] {
    const stores = this.dependencies.listActiveStores()
      .filter((store) => store.status === 'active')
      .map(cloneStoreRecord)
      .sort((left, right) => codepointCompare(left.storeId, right.storeId));
    const ids = new Set<StoreId>();
    const profiles = new Set<BrowserProfileId>();
    for (const store of stores) {
      if (store.marketplace !== 'US'
        || store.currency !== 'USD'
        || store.businessTimezone !== 'America/Los_Angeles'
        || ids.has(store.storeId)
        || profiles.has(store.browserProfileId)) {
        throw new StoreCollectionOrchestratorError(
          'UNSUPPORTED_STORE',
          '活跃店铺必须具有独立的 US/USD/America/Los_Angeles Store 与 Profile。',
        );
      }
      ids.add(store.storeId);
      profiles.add(store.browserProfileId);
    }
    return stores;
  }

export function exactActiveManualStore(this: StoreCollectionOrchestratorRuntime,
  context: StoreContextEnvelope,
  activeStores: readonly StoreRecord[]): StoreRecord {
    const exact = activeStores.find((store) => (
      store.storeId === context.storeId
      && store.browserProfileId === context.browserProfileId
      && store.marketplace === context.marketplace
      && store.currency === context.currency
      && store.businessTimezone === context.businessTimezone
    ));
    if (!exact) {
      throw new StoreCollectionOrchestratorError(
        'USER_OPERATION_BLOCKED',
        '手动采集目标不是当前 active US/USD/America/Los_Angeles Store/Profile。',
      );
    }
    return exact;
  }

export function assertManualContextCurrent(this: StoreCollectionOrchestratorRuntime,
  context: StoreContextEnvelope,
  currentAuthority: StoreCollectionAuthorityReadback): void {
    const expected: StoreCollectionAuthorityReadback = {
      activeStoreId: context.storeId,
      context,
    };
    if (!sameAuthority(currentAuthority, expected)) {
      throw new StoreCollectionOrchestratorError(
        'USER_OPERATION_BLOCKED',
        '手动采集上下文已过期；Store/Profile/业务日/会话代次与 Main authority 不完全一致。',
      );
    }
  }

export function stableManualStoreSnapshot(this: StoreCollectionOrchestratorRuntime,
  store: StoreRecord,
  exactContext: StoreContextEnvelope,
  attemptedCollectionKeys: ReadonlySet<string>): {
    due: Array<{
      store: StoreRecord;
      expectedFingerprint: string;
      requiredBusinessDate: string;
    }>;
    skipped: StoreRecord[];
  } {
    let inspected: StoreCollectionManualScheduleInspection;
    try {
      inspected = this.dependencies.inspectManualStoreSchedule(
        cloneStoreRecord(store),
        Object.freeze(normalizeStoreContextEnvelope(exactContext)),
      );
    } catch {
      throw new StoreCollectionOrchestratorError(
        'SCHEDULE_PRECHECK_FAILED',
        'Main-only 手动采集资格预检失败。',
      );
    }
    if ((inspected?.state !== 'eligible' && inspected?.state !== 'duplicate')
      || !validFingerprint(inspected.expectedFingerprint)) {
      throw new StoreCollectionOrchestratorError(
        'SCHEDULE_PRECHECK_FAILED',
        '手动采集资格预检缺少合法状态或 expected fingerprint。',
      );
    }
    const expectedFingerprint = inspected.expectedFingerprint;
    const protectedDuplicate = attemptedCollectionKeys.has(collectionAttemptSemanticKey({
      storeId: store.storeId,
      browserProfileId: store.browserProfileId,
      expectedFingerprint,
    }));
    if (inspected.state === 'duplicate' || protectedDuplicate) {
      return { due: [], skipped: [store] };
    }
    return {
      due: [{
        store,
        expectedFingerprint,
        requiredBusinessDate: exactContext.businessDate,
      }],
      skipped: [],
    };
  }

export function stableDueStoreSnapshot(this: StoreCollectionOrchestratorRuntime,
  activeStores: readonly StoreRecord[],
  attemptedCollectionKeys: ReadonlySet<string>): {
    due: Array<{ store: StoreRecord; expectedFingerprint: string }>;
    skipped: StoreRecord[];
  } {
    const due: Array<{ store: StoreRecord; expectedFingerprint: string }> = [];
    const skipped: StoreRecord[] = [];
    for (const store of activeStores) {
      let inspected: StoreCollectionScheduleInspection;
      try {
        inspected = this.dependencies.inspectStoreSchedule(cloneStoreRecord(store));
      } catch {
        throw new StoreCollectionOrchestratorError('SCHEDULE_PRECHECK_FAILED', 'Main-only 采集预检失败。');
      }
      if (inspected?.state === 'not_due') {
        skipped.push(store);
      } else if (inspected?.state === 'due' && validFingerprint(inspected.expectedFingerprint)) {
        const expectedFingerprint = inspected.expectedFingerprint;
        if (attemptedCollectionKeys.has(collectionAttemptSemanticKey({
          storeId: store.storeId,
          browserProfileId: store.browserProfileId,
          expectedFingerprint,
        }))) {
          skipped.push(store);
        } else {
          due.push({ store, expectedFingerprint });
        }
      } else {
        throw new StoreCollectionOrchestratorError('SCHEDULE_PRECHECK_FAILED', '采集预检缺少合法 expected fingerprint。');
      }
    }
    return { due, skipped };
  }
