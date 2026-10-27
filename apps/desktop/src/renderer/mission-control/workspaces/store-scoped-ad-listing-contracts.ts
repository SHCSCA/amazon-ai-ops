import { type StoreContextEnvelope, type StoreId } from '@amazon-ai-ops/shared-types';

export type AdObjectKind = 'campaign' | 'ad_group' | 'target' | 'search_term';

export type StoreAdObjectFactView = {
  storeId: StoreId;
  marketplace: 'US';
  currency: 'USD';
  kind: AdObjectKind;
  objectKey: string;
  entityId?: string;
  resolved?: boolean;
  nonExecutable?: boolean;
  resolutionReason?: 'STABLE_ENTITY_ID_UNAVAILABLE';
  name: string;
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
};

export type StoreKeywordFactView = {
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
};

export type StoreListingContentView = {
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
};

export type StoreListingContentVersionView = {
  id: number;
  listingContentId?: number;
  storeId: StoreId;
  asin: string;
  asinValid?: boolean;
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
};

export type ListingContentDraft = {
  asin: string;
  title: string;
  bulletsText: string;
  description: string;
  aPlus: string;
  imageCopy: string;
  backendTerms: string;
  source: string;
  versionLabel: string;
  changeSummary: string;
};

export type StoreAdListingRendererApi = {
  listStoreAdObjects(
    context: StoreContextEnvelope,
    input?: { kind?: AdObjectKind; query?: string; asin?: string; limit?: number },
  ): Promise<StoreAdObjectFactView[]>;
  listStoreKeywordFacts(
    context: StoreContextEnvelope,
    input?: { query?: string; asin?: string; limit?: number },
  ): Promise<StoreKeywordFactView[]>;
  listStoreListingContent(
    context: StoreContextEnvelope,
    input?: { query?: string; asin?: string; limit?: number },
  ): Promise<StoreListingContentView[]>;
  getStoreListingContent(
    context: StoreContextEnvelope,
    input: { id?: number; asin?: string },
  ): Promise<StoreListingContentView>;
  createStoreListingContent(
    context: StoreContextEnvelope,
    input: Record<string, unknown>,
  ): Promise<StoreListingContentView>;
  updateStoreListingContent(
    context: StoreContextEnvelope,
    input: { id: number; expectedRevision: string; patch: Record<string, unknown> },
  ): Promise<StoreListingContentView>;
  deleteStoreListingContent(
    context: StoreContextEnvelope,
    input: { id: number; expectedRevision: string },
  ): Promise<{ id: number; deleted: true }>;
  listStoreListingContentVersions(
    context: StoreContextEnvelope,
    input?: { listingContentId?: number; asin?: string; limit?: number; offset?: number },
  ): Promise<StoreListingContentVersionView[]>;
};

export type StoreScopedPanelProps = {
  storeContext: StoreContextEnvelope | null;
  api?: Partial<StoreAdListingRendererApi>;
};

export type ListingEditor = {
  current: StoreListingContentView | null;
  draft: ListingContentDraft;
};

export type ListingVersionHistory = {
  target: StoreListingContentView;
  rows: StoreListingContentVersionView[];
  selectedId: number | null;
  loading: boolean;
  error: string | null;
};

export type StoreListingVersionLedger = {
  rows: StoreListingContentVersionView[];
  selectedId: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextOffset: number;
  hasMore: boolean;
};

export type ListingRowActionsProps = {
  row: StoreListingContentView;
  pending: boolean;
  canHistory?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  historyBusy?: boolean;
  onHistory(): void;
  onEdit(): void;
  onDelete(): void;
};

export type ListingVersionHistoryDialogProps = {
  target: StoreListingContentView;
  rows: StoreListingContentVersionView[];
  selectedId: number | null;
  loading: boolean;
  error: string | null;
  onSelect(selectedId: number): void;
  onRetry(): void;
  onClose(): void;
};

export type StoreListingVersionLedgerDialogProps = {
  storeContext: StoreContextEnvelope;
  rows: StoreListingContentVersionView[];
  selectedId: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onSelect(selectedId: number): void;
  onRetry(): void;
  onLoadMore(): void;
  onClose(): void;
};
