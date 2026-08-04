import type {
  BusinessDate,
  StoreConnectionProvider,
  StoreConnectionStatus,
  StoreScopeRef,
  StoreSessionStatus,
  StoreStatus,
  UsCurrency,
  UsMarketplace,
} from './store';
import {
  normalizeStoreId,
  normalizeUsMarketplace,
  StoreContractError,
} from './store';

/** Durable operator choice. It is logical scope only and never carries browser authority. */
export interface OperatorWorkspaceSelection {
  schemaVersion: 1;
  storeId: StoreScopeRef['storeId'];
  marketplace: StoreScopeRef['marketplace'];
  selectedAt: string;
}

export interface ListStoreDailyStatusesInput {
  /** V1 is deliberately US-only and Main rejects an omitted or different marketplace. */
  marketplace: UsMarketplace;
  includeInactive?: boolean;
  includeArchived?: boolean;
}

export type StoreDailyProviderBindingState =
  | 'ready'
  | 'missing'
  | 'invalid'
  | 'unknown';

export interface StoreDailyProviderStatus {
  provider: StoreConnectionProvider;
  bindingState: StoreDailyProviderBindingState;
  connectionStatus: StoreConnectionStatus | 'missing' | 'unknown';
  sessionStatus: StoreSessionStatus | 'missing' | 'unknown';
  accountLabel?: string;
  externalAccountId?: string;
  lastVerifiedAt?: string;
  sessionObservedAt?: string;
}

export type StoreDailyCollectionState =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'unknown';

export interface StoreDailyCollectionStatus {
  state: StoreDailyCollectionState;
  requiredReportCount: 8;
  /** Omitted when durable evidence is corrupt or otherwise unknowable. */
  downloadedReportCount?: number;
  jobId?: string;
  requestId?: string;
  updatedAt?: string;
  completedAt?: string;
}

export type StoreDailyImportState =
  | 'not_started'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'not_applicable'
  | 'unknown';

export interface StoreDailyImportStatus {
  state: StoreDailyImportState;
  /** Counts are omitted when the immutable proof is not uniquely readable. */
  importedReportCount?: number;
  metricRowCount?: number;
  completedAt?: string;
}

export type StoreDailyMetricFreshness = 'fresh' | 'stale' | 'missing' | 'unknown';

export interface StoreDailyMetricStatus {
  freshness: StoreDailyMetricFreshness;
  expectedMetricDate: string;
  latestMetricDate?: string;
  /** Whole calendar days behind expectedMetricDate. Omitted for missing/unknown evidence. */
  lagDays?: number;
  rowCount?: number;
  lastImportedAt?: string;
}

export type StoreDailyStatusBlockerCode =
  | 'STORE_INACTIVE'
  | 'STORE_ARCHIVED'
  | 'STORE_AUTHORITY_INVALID'
  | 'LINGXING_BINDING_MISSING'
  | 'LINGXING_BINDING_INVALID'
  | 'LINGXING_SESSION_NOT_READY'
  | 'AMAZON_ADS_BINDING_MISSING'
  | 'AMAZON_ADS_BINDING_INVALID'
  | 'AMAZON_ADS_SESSION_NOT_READY'
  | 'PROVIDER_AUTHORITY_UNKNOWN'
  | 'COLLECTION_FAILED'
  | 'COLLECTION_AUTHORITY_UNKNOWN'
  | 'IMPORT_FAILED'
  | 'IMPORT_AUTHORITY_UNKNOWN'
  | 'METRICS_MISSING'
  | 'METRICS_STALE'
  | 'METRICS_AUTHORITY_UNKNOWN';

export interface StoreDailyStatusBlocker {
  code: StoreDailyStatusBlockerCode;
  severity: 'attention' | 'blocking' | 'unknown';
  detail: string;
  provider?: StoreConnectionProvider;
}

export type StoreDailyOverallState =
  | 'ready'
  | 'in_progress'
  | 'not_started'
  | 'attention_required'
  | 'blocked'
  | 'inactive'
  | 'archived'
  | 'unknown';

/** Renderer-safe, path-free status for one Store + Marketplace + business date. */
export interface StoreDailyStatusProjection {
  schemaVersion: 1;
  key: {
    storeId: StoreScopeRef['storeId'];
    marketplace: StoreScopeRef['marketplace'];
    businessDate: BusinessDate;
  };
  displayName: string;
  storeStatus: StoreStatus;
  currency: UsCurrency;
  selected: boolean;
  eligibleForCollection: boolean;
  providers: {
    lingxing: StoreDailyProviderStatus;
    amazonAds: StoreDailyProviderStatus;
  };
  collection: StoreDailyCollectionStatus;
  import: StoreDailyImportStatus;
  metrics: StoreDailyMetricStatus;
  overall: StoreDailyOverallState;
  blockers: readonly StoreDailyStatusBlocker[];
  generatedAt: string;
}

/** One coherent read timestamp and deterministic store ordering for the sidebar/workbench. */
export interface StoreDailyStatusListProjection {
  schemaVersion: 1;
  marketplace: UsMarketplace;
  generatedAt: string;
  stores: readonly StoreDailyStatusProjection[];
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoreContractError('INVALID_STORE_IDENTITY', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** Strict persisted-selection parser. Corrupt or legacy values fail closed. */
export function normalizeOperatorWorkspaceSelection(
  value: unknown,
): OperatorWorkspaceSelection {
  const input = recordOf(value, 'operator workspace selection');
  if (input.schemaVersion !== 1) {
    throw new StoreContractError(
      'INVALID_STORE_IDENTITY',
      'operator workspace selection schemaVersion must be 1',
    );
  }
  if (input.marketplace === undefined) {
    throw new StoreContractError(
      'UNSUPPORTED_MARKETPLACE',
      'operator workspace selection marketplace is required',
    );
  }
  if (typeof input.selectedAt !== 'string'
    || !input.selectedAt.trim()
    || Number.isNaN(Date.parse(input.selectedAt))) {
    throw new StoreContractError(
      'INVALID_STORE_IDENTITY',
      'operator workspace selection selectedAt must be an ISO timestamp',
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    storeId: normalizeStoreId(input.storeId),
    marketplace: normalizeUsMarketplace(input.marketplace),
    selectedAt: new Date(input.selectedAt).toISOString(),
  });
}

/** Renderer/Main list boundary. Marketplace is explicit even though V1 has one value. */
export function normalizeListStoreDailyStatusesInput(
  value: unknown,
): ListStoreDailyStatusesInput {
  const input = recordOf(value, 'store daily status list input');
  if (input.marketplace === undefined) {
    throw new StoreContractError(
      'UNSUPPORTED_MARKETPLACE',
      'store daily status marketplace is required',
    );
  }
  if (input.includeInactive !== undefined && typeof input.includeInactive !== 'boolean') {
    throw new StoreContractError(
      'INVALID_STORE_IDENTITY',
      'includeInactive must be a boolean',
    );
  }
  if (input.includeArchived !== undefined && typeof input.includeArchived !== 'boolean') {
    throw new StoreContractError(
      'INVALID_STORE_IDENTITY',
      'includeArchived must be a boolean',
    );
  }
  return Object.freeze({
    marketplace: normalizeUsMarketplace(input.marketplace),
    ...(input.includeInactive === undefined
      ? {}
      : { includeInactive: input.includeInactive }),
    ...(input.includeArchived === undefined
      ? {}
      : { includeArchived: input.includeArchived }),
  });
}
