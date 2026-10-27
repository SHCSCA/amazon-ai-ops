import type { Database } from 'better-sqlite3';
import { type LingxingReportType, type StoreId } from '@amazon-ai-ops/shared-types';
import type { StoreCoordinator } from './store-coordinator';

export type StoreIdentityHints = {
  storeName?: unknown;
  store_name?: unknown;
  marketplace?: unknown;
  marketplaceCode?: unknown;
  marketplace_code?: unknown;
  currency?: unknown;
};

export type StoreScopedAdObjectKind = 'campaign' | 'ad_group' | 'target' | 'search_term';

export interface StoreScopedAdObjectFact {
  storeId: StoreId;
  marketplace: 'US';
  currency: 'USD';
  kind: StoreScopedAdObjectKind;
  objectKey: string;
  entityId?: string;
  entityRevision?: number;
  adsAccountId?: string;
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
  objectRevision?: number;
  resolved: boolean;
  nonExecutable: boolean;
  resolutionReason?: 'STABLE_ENTITY_ID_UNAVAILABLE';
  name: string;
  matchType?: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
  firstDate?: string;
  lastDate?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number;
  cpc: number;
  cvr: number;
  sourceRowCount: number;
  sourceFileCount: number;
  reportTypeCount: number;
}

export interface StoreScopedKeywordFact {
  storeId: StoreId;
  marketplace: 'US';
  currency: 'USD';
  keyword: string;
  asin?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
  acos: number;
  cvr: number;
  sourceRowCount: number;
  opportunityLevel?: string;
  opportunityScore?: number;
  opportunityStatus?: string;
  evidence?: string;
  riskFlags: string[];
  recommendedSections: string[];
  lastObservedAt?: string;
}

export interface VersionedStoreListingContent {
  id: number;
  storeId: StoreId;
  storeName: string;
  marketplace: 'US';
  currency: 'USD';
  asin: string;
  asinValid: boolean;
  title: string;
  bullets: string[];
  description: string;
  aPlus: string;
  imageCopy: string;
  backendTerms: string;
  source: string;
  versionLabel: string;
  changeSummary: string;
  createdAt: string;
  updatedAt: string;
  revision: string;
}

export interface StoreListingContentVersion {
  id: number;
  listingContentId?: number;
  storeId: StoreId;
  asin: string;
  asinValid: boolean;
  title: string;
  bullets: string[];
  description: string;
  aPlus: string;
  imageCopy: string;
  backendTerms: string;
  source: string;
  versionLabel: string;
  changeSummary: string;
  createdAt: string;
}

export interface StoreAdObjectListInput extends StoreIdentityHints {
  kind?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  asin?: unknown;
  query?: unknown;
  limit?: unknown;
}

export interface StoreKeywordFactListInput extends StoreIdentityHints {
  asin?: unknown;
  query?: unknown;
  limit?: unknown;
}

export interface StoreListingContentListInput extends StoreIdentityHints {
  asin?: unknown;
  query?: unknown;
  limit?: unknown;
}

export interface StoreListingContentLookupInput extends StoreIdentityHints {
  id?: unknown;
  asin?: unknown;
}

export interface StoreListingContentCreateInput extends StoreIdentityHints {
  asin: unknown;
  title?: unknown;
  bullets?: unknown;
  description?: unknown;
  aPlus?: unknown;
  a_plus?: unknown;
  imageCopy?: unknown;
  image_copy?: unknown;
  backendTerms?: unknown;
  backend_terms?: unknown;
  source?: unknown;
  versionLabel?: unknown;
  version_label?: unknown;
  changeSummary?: unknown;
  change_summary?: unknown;
}

export interface StoreListingContentUpdateInput {
  id: unknown;
  expectedRevision?: unknown;
  patch: unknown;
}

export interface StoreListingContentDeleteInput {
  id: unknown;
  expectedRevision?: unknown;
}

export interface StoreListingVersionListInput extends StoreIdentityHints {
  listingContentId?: unknown;
  asin?: unknown;
  limit?: unknown;
  offset?: unknown;
}

export type StoreScopedAdListingErrorCode =
  | 'INVALID_INPUT'
  | 'STORE_IDENTITY_MISMATCH'
  | 'OBJECT_NOT_FOUND'
  | 'OBJECT_ALREADY_EXISTS'
  | 'CAS_REQUIRED'
  | 'OBJECT_CONFLICT'
  | 'WRITE_FAILED';

export class StoreScopedAdListingError extends Error {
  constructor(readonly code: StoreScopedAdListingErrorCode, message: string) {
    super(message);
    this.name = 'StoreScopedAdListingError';
  }
}

export interface StoreScopedAdListingServiceOptions {
  db: Database;
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext' | 'getStore'>;
}

export type ListingRow = {
  id: number;
  store_id: string;
  store_name: string | null;
  marketplace_code: string | null;
  asin: string;
  title: string | null;
  bullets_json: string | null;
  description: string | null;
  a_plus: string | null;
  image_copy: string | null;
  backend_terms: string | null;
  source: string | null;
  version_label: string | null;
  change_summary: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type KeywordAggregateRow = {
  asin: string | null;
  normalized_keyword: string;
  impressions: number | null;
  clicks: number | null;
  spend: number | null;
  orders: number | null;
  sales: number | null;
  source_row_count: number | null;
  last_observed_at: string | null;
};

export type KeywordOpportunityRow = {
  asin: string | null;
  normalized_keyword: string;
  opportunity_level: string | null;
  score: number | null;
  evidence: string | null;
  risk_flags_json: string | null;
  recommended_sections_json: string | null;
  status: string | null;
  updated_at: string | null;
};

export type ProductionLineageJobRow = {
  job_id: string;
  date_start: string;
  date_end: string;
  report_types_json: string;
  snapshot_json: string;
  created_at: string;
};

export type ProductionLineage = {
  lineageId: string;
  rootJobId: string;
  parentJobId?: string;
  expectedReportTypes: LingxingReportType[];
  purpose: 'production_full' | 'resume' | 'retry';
};

export type ProductionLineageJob = {
  jobId: string;
  dateStart: string;
  dateEnd: string;
  reportTypes: LingxingReportType[];
  lineage?: ProductionLineage;
  createdAt: string;
};

export type ProductionImportProofRow = {
  batchId: string;
  reportType: string;
  runCompletedAt: string;
};

export type ProductionAdAuthority = {
  dateStart: string;
  dateEnd: string;
  batchByReportType: ReadonlyMap<LingxingReportType, string>;
};

export type StableAdEntityAuthorityRow = {
  metric_id: number;
  current_entity_revision: number;
  authority_id: string;
  ad_entity_id: string;
  entity_revision: number;
  source_report_type: string;
  entity_name: string;
  campaign_name: string;
  ad_group_name: string;
  match_type: string | null;
  ads_account_id: string | null;
  campaign_id: string | null;
  ad_group_id: string | null;
  keyword_id: string | null;
  object_revision: number | null;
};

export type CanonicalKeywordIdentity = {
  adsAccountId: string;
  campaignId: string;
  adGroupId: string;
  keywordId: string;
  objectRevision: number;
};

export type StableAdEntityAuthority = {
  metricId: number;
  authorityId: string;
  currentEntityRevision: number;
  entityId: string;
  entityRevision: number;
  canonicalKeywordIdentity?: CanonicalKeywordIdentity;
};
