export type LingxingReportType =
  | 'campaign'
  | 'ad_group'
  | 'placement'
  | 'advertised_product'
  | 'auto_targeting'
  | 'keyword'
  | 'product_targeting'
  | 'user_search_term';

export type ReportFileStatus =
  | 'pending'
  | 'creating'
  | 'created'
  | 'generating'
  | 'ready'
  | 'downloading'
  | 'downloaded'
  | 'failed'
  | 'skipped';

export interface LingxingReportDefinition {
  type: LingxingReportType;
  displayName: string;
  expectedFilenameKeyword: string;
}

export interface DownloadCenterSelectorHint {
  name: string;
  selector: string;
  required?: boolean;
}

export interface DownloadCenterPageModel {
  name: string;
  description: string;
  candidateUrls: string[];
  entryHints: string[];
  reportNames: string[];
  verifySelectors: DownloadCenterSelectorHint[];
  actionSelectors?: DownloadCenterActionSelectors;
  requiresManualVerification: boolean;
}

export interface DownloadCenterActionSelectors {
  reportSearchInput?: string;
  dateStartInput?: string;
  dateEndInput?: string;
  createReportButton: string;
  confirmCreateButton?: string;
  readyReportSelector: string;
  statusTextSelector?: string;
  downloadButton: string;
  readyTimeoutMs?: number;
  downloadTimeoutMs?: number;
}

export interface DownloadCenterPageSnapshot {
  url: string;
  title: string;
  bodyText: string;
  selectorMatches: Record<string, boolean>;
}

export interface DownloadCenterSelectorCandidate {
  role: string;
  text: string;
  tagName: string;
  selector: string;
  matchCount?: number;
  unique?: boolean;
  attributes?: Record<string, string>;
}

export interface DownloadCenterActionSelectorCheck {
  name: string;
  selector: string;
  renderedSelector: string;
  required: boolean;
  kind: 'input' | 'click' | 'row' | 'status' | 'optional';
  reportType?: LingxingReportType;
  reportDisplayName?: string;
  matchCount: number;
  found: boolean;
  usable: boolean;
  ambiguous: boolean;
  errorMessage?: string;
}

export interface DownloadCenterDiagnosticResult {
  id?: number;
  appVersion?: string;
  pageModel: string;
  pageModelSource?: 'bundled' | 'override';
  pageModelSnapshot?: DownloadCenterPageModel;
  dateStart?: string;
  dateEnd?: string;
  url: string;
  title: string;
  ready: boolean;
  requiresManualVerification: boolean;
  matchedEntryHints: string[];
  matchedReportNames: string[];
  selectorChecks: Array<DownloadCenterSelectorHint & { found: boolean }>;
  missingRequiredSelectors: string[];
  selectorCandidates?: DownloadCenterSelectorCandidate[];
  actionSelectorChecks?: DownloadCenterActionSelectorCheck[];
  checkedAt: string;
  screenshotPath?: string;
  domSnapshotPath?: string;
  errorMessage?: string;
}

export interface LingxingReportBatch {
  id: string;
  appVersion?: string;
  dateStart: string;
  dateEnd: string;
  status: 'pending' | 'running' | 'completed' | 'completed_with_errors' | 'failed';
  downloadDir: string;
  manifestPath?: string;
  createdAt: string;
  completedAt?: string;
}

export interface LingxingReportFile {
  id: string;
  batchId: string;
  reportType: LingxingReportType;
  displayName: string;
  status: ReportFileStatus;
  maxAutoRetries?: number;
  autoRetryCount?: number;
  filePath?: string;
  fileSizeBytes?: number;
  errorMessage?: string;
  attemptErrors?: string[];
  failureScreenshotPath?: string;
  failureDomSnapshotPath?: string;
  failureTracePath?: string;
  traceUnavailableReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KeywordMetric {
  id?: number;
  normalizedKeyword: string;
  rawKeyword: string;
  source: 'search_term' | 'sqp' | 'keyword_report' | 'manual';
  asin?: string;
  clicks: number;
  impressions: number;
  cost: number;
  orders: number;
  sales: number;
  acos: number;
  cvr: number;
  sourceFile?: string;
  sourceRow?: number;
}

export type ListingSection = 'title' | 'bullet' | 'a_plus' | 'image_copy' | 'backend_terms';

export interface ListingContent {
  id?: number;
  asin: string;
  title: string;
  bullets: string[];
  aPlus?: string;
  imageCopy?: string;
  backendTerms?: string;
  updatedAt?: string;
}

export interface KeywordOpportunity {
  id?: number;
  asin?: string;
  normalizedKeyword: string;
  opportunityLevel: 'high' | 'medium' | 'low';
  score: number;
  evidence: string;
  riskFlags: string[];
  recommendedSections: ListingSection[];
  status: 'pending' | 'accepted' | 'ignored';
}

export interface KeywordCoverage {
  normalizedKeyword: string;
  covered: boolean;
  sections: ListingSection[];
  strength: number;
}

export interface ListingSuggestion {
  id?: number;
  appVersion?: string;
  asin: string;
  keyword: string;
  section: ListingSection;
  currentText?: string;
  suggestedText: string;
  evidence: string;
  riskWarnings: string[];
  status: 'pending' | 'accepted' | 'ignored';
  createdAt?: string;
}

export interface ListingDraft {
  id?: number;
  appVersion?: string;
  asin: string;
  section: ListingSection;
  currentText?: string;
  draftedText: string;
  keywords: string[];
  evidence: string;
  riskWarnings: string[];
  source: 'ai' | 'rule';
  status: 'pending' | 'accepted' | 'ignored';
  createdAt?: string;
}
