import type { LingxingCollectionJobSnapshot } from './lingxing-collection';
import type { BrowserProfileId, BusinessDate, StoreContextEnvelope, StoreId } from './store';

export const STORE_COLLECTION_SCHEDULE_STATES = [
  'not_configured',
  'archived',
  'waiting',
  'due',
  'claimed',
  'succeeded',
  'failed',
] as const;

export type StoreCollectionScheduleState = (typeof STORE_COLLECTION_SCHEDULE_STATES)[number];
export type StoreCollectionScheduleTrigger = 'scheduled' | 'manual';

/** Path-free durable idempotency record safe for Renderer projection. */
export interface StoreCollectionScheduleAttempt {
  schemaVersion: 1;
  /** Business idempotency identity. This deliberately excludes sessionGeneration. */
  fingerprint: string;
  /** Digest of the complete decrypted record; the Main persistence envelope supplies authentication. */
  integrityDigest: string;
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  sessionGeneration: number;
  businessDate: BusinessDate;
  scheduleLocalTime: string;
  configRevision: number;
  lookbackDays: number;
  dateStart: string;
  dateEnd: string;
  requestId: string;
  trigger: StoreCollectionScheduleTrigger;
  state: 'claimed' | 'succeeded' | 'failed';
  claimedAt: string;
  completedAt?: string;
  failureCode?: string;
}

export interface StoreCollectionScheduleProjection {
  storeId: StoreId;
  businessDate: BusinessDate;
  enabled: boolean;
  state: StoreCollectionScheduleState;
  detail: string;
  scheduleLocalTime?: string;
  configRevision?: number;
  dateStart?: string;
  dateEnd?: string;
  fingerprint?: string;
  lastAttempt?: StoreCollectionScheduleAttempt;
}

export interface StoreCollectionScheduleRequest {
  storeContext: StoreContextEnvelope;
}

export interface StoreCollectionScheduleRunResult {
  accepted: boolean;
  duplicate: boolean;
  projection: StoreCollectionScheduleProjection;
  job?: LingxingCollectionJobSnapshot;
}
