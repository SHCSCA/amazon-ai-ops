export interface AdReadbackAuthorityScope {
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  batchId: string;
}

export interface AdReadbackAuthorityRecord extends AdReadbackAuthorityScope {
  recommendationId: number;
  recommendationRevision: number;
  recommendationStatusAtExport: 'approved';
  checkedAt: string;
}

export interface AdReadbackOperatorEvidence {
  approval?: Record<string, unknown>;
  risk?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  readback?: Record<string, unknown>;
  execution?: Record<string, unknown>;
}

export interface ExportAdReadbackEvidenceRequest {
  recommendationId: number;
  expectedRevision: number;
  scope: AdReadbackAuthorityScope;
  operatorEvidence: AdReadbackOperatorEvidence;
}

export interface ExportAdReadbackEvidenceResult {
  jsonPath: string;
  markdownPath: string;
  sha256: string;
  status: 'PASS' | 'NEEDS_WORK';
  readyForVerifier: boolean;
  nextAction: 'verify' | 'prepare';
  authority: {
    recommendationId: number;
    revision: number;
    batchId: string;
  };
}
