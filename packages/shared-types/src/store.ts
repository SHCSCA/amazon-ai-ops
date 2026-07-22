/**
 * V1 store authority contract.
 *
 * V1 deliberately supports Amazon US and USD only. These types describe
 * logical identities that are safe to cross the Renderer/Main boundary. Local
 * profile, download, database, and evidence paths remain Main-owned and must
 * never be added to these contracts.
 */

declare const storeIdBrand: unique symbol;
declare const storeCapabilityIdBrand: unique symbol;
declare const browserProfileIdBrand: unique symbol;
declare const businessDateBrand: unique symbol;

export type StoreId = string & { readonly [storeIdBrand]: 'StoreId' };
export type StoreCapabilityId = string & {
  readonly [storeCapabilityIdBrand]: 'StoreCapabilityId';
};
export type BrowserProfileId = string & {
  readonly [browserProfileIdBrand]: 'BrowserProfileId';
};
export type BusinessDate = string & { readonly [businessDateBrand]: 'BusinessDate' };

export const US_MARKETPLACE = 'US' as const;
export const USD_CURRENCY = 'USD' as const;
export const DEFAULT_US_BUSINESS_TIMEZONE = 'America/Los_Angeles' as const;

export type UsMarketplace = typeof US_MARKETPLACE;
export type UsCurrency = typeof USD_CURRENCY;
export type SessionGeneration = number;

export type StoreStatus = 'active' | 'inactive' | 'archived';

export interface UsStoreIdentity {
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  marketplace: UsMarketplace;
  currency: UsCurrency;
}

export interface StoreRecord extends UsStoreIdentity {
  displayName: string;
  status: StoreStatus;
  businessTimezone: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

/**
 * Store-bound request context. Main must verify every field against its own
 * authority records before a collection or mutation; this envelope is not an
 * authorization token.
 */
export interface StoreContextEnvelope extends UsStoreIdentity {
  businessTimezone: string;
  businessDate: BusinessDate;
  sessionGeneration: SessionGeneration;
}

export interface StoreContextEnvelopeInput {
  storeId: unknown;
  browserProfileId: unknown;
  marketplace?: unknown;
  currency?: unknown;
  businessTimezone: unknown;
  businessDate: unknown;
  sessionGeneration: unknown;
}

export type StoreConnectionProvider = 'lingxing' | 'amazon_ads';
export type StoreConnectionStatus =
  | 'not_configured'
  | 'checking'
  | 'ready'
  | 'attention_required'
  | 'blocked';

export type StoreSessionStatus =
  | 'unknown'
  | 'signed_out'
  | 'checking'
  | 'ready'
  | 'expired'
  | 'blocked';

/**
 * Non-secret session projection. Passwords, cookies, tokens, browser state,
 * and filesystem paths are intentionally absent.
 */
export interface StoreSessionMetadata {
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  provider: StoreConnectionProvider;
  status: StoreSessionStatus;
  sessionGeneration: SessionGeneration;
  observedAt: string;
  accountLabel?: string;
  externalAccountId?: string;
  verifiedAt?: string;
  expiresAt?: string;
  failureCode?: string;
}

/** One store-to-provider capability binding. */
export interface StoreConnection {
  id: StoreCapabilityId;
  storeId: StoreId;
  provider: StoreConnectionProvider;
  status: StoreConnectionStatus;
  accountLabel?: string;
  externalAccountId?: string;
  lastVerifiedAt?: string;
  lastFailureCode?: string;
  session?: StoreSessionMetadata;
  createdAt: string;
  updatedAt: string;
}

/** Renderer-safe projection returned after a Main-authorized store switch. */
export interface StoreWorkspaceView {
  store: StoreRecord;
  context: StoreContextEnvelope;
  connections: StoreConnection[];
  sessions: StoreSessionMetadata[];
}

/** Renderer-safe store creation payload. Main allocates store/profile ids. */
export interface CreateStoreInput {
  displayName: string;
  marketplace?: UsMarketplace;
  currency?: UsCurrency;
  businessTimezone?: string;
}

/** Renderer-safe mutable store fields. Empty patches must be rejected by Main. */
export interface UpdateStorePatch {
  displayName?: string;
  status?: Exclude<StoreStatus, 'archived'>;
  businessTimezone?: string;
}

export interface UpdateStoreInput {
  storeId: StoreId;
  patch: UpdateStorePatch;
  expectedUpdatedAt?: string;
}

export interface GetStoreInput {
  storeId: StoreId;
}

export interface ListStoresInput {
  statuses?: readonly StoreStatus[];
  includeArchived?: boolean;
}

/** Delete semantics are archival in V1; there is no hard-delete command. */
export interface ArchiveStoreInput {
  storeId: StoreId;
  expectedUpdatedAt?: string;
  reason?: string;
}

export interface RestoreStoreInput {
  storeId: StoreId;
  expectedUpdatedAt?: string;
}

export interface CreateStoreConnectionInput {
  storeId: StoreId;
  provider: StoreConnectionProvider;
  accountLabel?: string;
  externalAccountId?: string;
}

export interface UpdateStoreConnectionInput {
  id: StoreCapabilityId;
  storeId: StoreId;
  accountLabel?: string;
  externalAccountId?: string;
}

export interface RemoveStoreConnectionInput {
  id: StoreCapabilityId;
  storeId: StoreId;
}

export type StoreContractErrorCode =
  | 'INVALID_STORE_ID'
  | 'INVALID_STORE_CAPABILITY_ID'
  | 'INVALID_BROWSER_PROFILE_ID'
  | 'UNSUPPORTED_MARKETPLACE'
  | 'UNSUPPORTED_CURRENCY'
  | 'INVALID_BUSINESS_TIMEZONE'
  | 'INVALID_BUSINESS_DATE'
  | 'INVALID_SESSION_GENERATION'
  | 'INVALID_STORE_IDENTITY'
  | 'INVALID_STORE_CONTEXT';

export class StoreContractError extends Error {
  readonly code: StoreContractErrorCode;

  constructor(code: StoreContractErrorCode, message: string) {
    super(message);
    this.name = 'StoreContractError';
    this.code = code;
  }
}

const LOGICAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeLogicalId(
  value: unknown,
  label: string,
  code:
    | 'INVALID_STORE_ID'
    | 'INVALID_STORE_CAPABILITY_ID'
    | 'INVALID_BROWSER_PROFILE_ID',
): string {
  if (typeof value !== 'string') {
    throw new StoreContractError(code, `${label} must be a logical string identifier`);
  }

  const normalized = value.trim().toLowerCase();
  if (!LOGICAL_ID_PATTERN.test(normalized)) {
    throw new StoreContractError(
      code,
      `${label} must be 1-128 letters, numbers, dots, underscores, or hyphens and must not be a path`,
    );
  }
  return normalized;
}

export function normalizeStoreId(value: unknown): StoreId {
  return normalizeLogicalId(value, 'storeId', 'INVALID_STORE_ID') as StoreId;
}

export function normalizeStoreCapabilityId(value: unknown): StoreCapabilityId {
  return normalizeLogicalId(
    value,
    'storeCapabilityId',
    'INVALID_STORE_CAPABILITY_ID',
  ) as StoreCapabilityId;
}

export function normalizeBrowserProfileId(value: unknown): BrowserProfileId {
  return normalizeLogicalId(
    value,
    'browserProfileId',
    'INVALID_BROWSER_PROFILE_ID',
  ) as BrowserProfileId;
}

export function assertUsMarketplace(value: unknown): asserts value is UsMarketplace {
  if (value !== US_MARKETPLACE) {
    throw new StoreContractError(
      'UNSUPPORTED_MARKETPLACE',
      `V1 supports marketplace ${US_MARKETPLACE} only`,
    );
  }
}

export function normalizeUsMarketplace(value: unknown = US_MARKETPLACE): UsMarketplace {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : value;
  assertUsMarketplace(normalized);
  return normalized;
}

export function assertUsdCurrency(value: unknown): asserts value is UsCurrency {
  if (value !== USD_CURRENCY) {
    throw new StoreContractError(
      'UNSUPPORTED_CURRENCY',
      `V1 supports currency ${USD_CURRENCY} only`,
    );
  }
}

export function normalizeUsdCurrency(value: unknown = USD_CURRENCY): UsCurrency {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : value;
  assertUsdCurrency(normalized);
  return normalized;
}

export function normalizeBusinessTimezone(
  value: unknown = DEFAULT_US_BUSINESS_TIMEZONE,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StoreContractError(
      'INVALID_BUSINESS_TIMEZONE',
      'businessTimezone must be a valid IANA timezone',
    );
  }

  const normalized = value.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(0);
  } catch {
    throw new StoreContractError(
      'INVALID_BUSINESS_TIMEZONE',
      'businessTimezone must be a valid IANA timezone',
    );
  }
  return normalized;
}

export function assertBusinessDate(value: unknown): asserts value is BusinessDate {
  if (typeof value !== 'string') {
    throw new StoreContractError(
      'INVALID_BUSINESS_DATE',
      'businessDate must use YYYY-MM-DD',
    );
  }

  const match = BUSINESS_DATE_PATTERN.exec(value);
  if (!match) {
    throw new StoreContractError(
      'INVALID_BUSINESS_DATE',
      'businessDate must use YYYY-MM-DD',
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new StoreContractError('INVALID_BUSINESS_DATE', 'businessDate is not a real date');
  }
}

export function normalizeBusinessDate(value: unknown): BusinessDate {
  const normalized = typeof value === 'string' ? value.trim() : value;
  assertBusinessDate(normalized);
  return normalized;
}

export function assertSessionGeneration(
  value: unknown,
): asserts value is SessionGeneration {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new StoreContractError(
      'INVALID_SESSION_GENERATION',
      'sessionGeneration must be a non-negative safe integer',
    );
  }
}

export function normalizeSessionGeneration(value: unknown): SessionGeneration {
  assertSessionGeneration(value);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeUsStoreIdentity(value: unknown): UsStoreIdentity {
  if (!isObject(value)) {
    throw new StoreContractError('INVALID_STORE_IDENTITY', 'store identity must be an object');
  }

  return {
    storeId: normalizeStoreId(value.storeId),
    browserProfileId: normalizeBrowserProfileId(value.browserProfileId),
    marketplace: normalizeUsMarketplace(value.marketplace),
    currency: normalizeUsdCurrency(value.currency),
  };
}

export function assertUsStoreIdentity(value: unknown): asserts value is UsStoreIdentity {
  if (!isObject(value)) {
    throw new StoreContractError('INVALID_STORE_IDENTITY', 'store identity must be an object');
  }

  const storeId = normalizeStoreId(value.storeId);
  const browserProfileId = normalizeBrowserProfileId(value.browserProfileId);
  assertUsMarketplace(value.marketplace);
  assertUsdCurrency(value.currency);
  if (value.storeId !== storeId || value.browserProfileId !== browserProfileId) {
    throw new StoreContractError(
      'INVALID_STORE_IDENTITY',
      'store identity must already use canonical logical identifiers',
    );
  }
}

export function normalizeStoreContextEnvelope(value: unknown): StoreContextEnvelope {
  if (!isObject(value)) {
    throw new StoreContractError('INVALID_STORE_CONTEXT', 'store context must be an object');
  }

  const identity = normalizeUsStoreIdentity(value);
  return {
    ...identity,
    businessTimezone: normalizeBusinessTimezone(value.businessTimezone),
    businessDate: normalizeBusinessDate(value.businessDate),
    sessionGeneration: normalizeSessionGeneration(value.sessionGeneration),
  };
}

export function assertStoreContextEnvelope(
  value: unknown,
): asserts value is StoreContextEnvelope {
  if (!isObject(value)) {
    throw new StoreContractError('INVALID_STORE_CONTEXT', 'store context must be an object');
  }

  assertUsStoreIdentity(value);
  const timezone = normalizeBusinessTimezone(value.businessTimezone);
  if (value.businessTimezone !== timezone) {
    throw new StoreContractError(
      'INVALID_STORE_CONTEXT',
      'businessTimezone must already use its canonical IANA value',
    );
  }
  assertBusinessDate(value.businessDate);
  assertSessionGeneration(value.sessionGeneration);
}
