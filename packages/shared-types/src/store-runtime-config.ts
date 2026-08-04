import type { StoreId, UsCurrency, UsMarketplace } from './store';

/**
 * Store-owned operating preferences for the US/USD desktop product.
 *
 * Execution authority, autonomy mode, bid-change caps and kill switches are
 * deliberately absent. Those safety controls remain owned by the Policy and
 * Execution domains instead of being duplicated in a convenience settings
 * form.
 */
export interface StoreRuntimeConfigValues {
  aiRecommendationsEnabled: boolean;
  collectionScheduleLocalTime: string;
  collectionLookbackDays: number;
  analysisWindowDays: number;
  defaultTargetAcosPercent: number;
  minimumRecommendationConfidencePercent: number;
  evidenceRetentionDays: number;
}
export type StoreRuntimeConfigStatus = 'active' | 'archived';
export type StoreRuntimeConfigVersionAction = 'create' | 'update' | 'archive' | 'restore';

export interface StoreRuntimeConfigRecord {
  configId: string;
  storeId: StoreId;
  marketplace: UsMarketplace;
  currency: UsCurrency;
  businessTimezone: string;
  status: StoreRuntimeConfigStatus;
  revision: number;
  values: StoreRuntimeConfigValues;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface StoreRuntimeConfigVersion {
  revision: number;
  action: StoreRuntimeConfigVersionAction;
  occurredAt: string;
  reason?: string;
  snapshot: StoreRuntimeConfigRecord;
}

export interface StoreRuntimeConfigProjection {
  current: StoreRuntimeConfigRecord | null;
  versions: StoreRuntimeConfigVersion[];
}

export interface CreateStoreRuntimeConfigInput {
  values: StoreRuntimeConfigValues;
}

export interface UpdateStoreRuntimeConfigInput {
  expectedRevision: number;
  patch: Partial<StoreRuntimeConfigValues>;
}

export interface ArchiveStoreRuntimeConfigInput {
  expectedRevision: number;
  reason?: string;
}

export interface RestoreStoreRuntimeConfigInput {
  expectedRevision: number;
}
