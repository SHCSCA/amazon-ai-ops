/**
 * Renderer-safe Store Evidence retention preview.
 *
 * The complete manifest, including candidate/protected filenames and filesystem
 * metadata, is Main-only. This projection intentionally carries aggregate
 * counts and normalized blocker codes only.
 */
export type StoreEvidenceRetentionPreviewBlockerCode =
  | 'INVALID_STORE_CAPSULE'
  | 'MISSING_CAPSULE_PATH'
  | 'PATH_ESCAPE'
  | 'CROSS_STORE_REFERENCE'
  | 'DATABASE_REFERENCE_OWNERSHIP_MISMATCH'
  | 'UNRESOLVED_ARTIFACT_REFERENCE'
  | 'MISSING_REFERENCE'
  | 'UNSAFE_LINK_OR_REPARSE_POINT'
  | 'HARD_LINKED_FILE'
  | 'UNSUPPORTED_FILESYSTEM_ENTRY'
  | 'FILESYSTEM_INSPECTION_FAILED';

export interface StoreEvidenceRetentionPreviewBlocker {
  readonly code: StoreEvidenceRetentionPreviewBlockerCode;
  readonly detail: string;
}

export interface StoreEvidenceRetentionPreviewSummary {
  readonly schemaVersion: 1;
  readonly mode: 'dry-run';
  readonly deletionSupported: false;
  readonly applyable: false;
  readonly generatedAt: string;
  readonly storeId: string;
  readonly profileId: string;
  readonly marketplace: 'US';
  readonly currency: 'USD';
  readonly retentionDays: number;
  readonly cutoffAt: string;
  readonly expiryBasis: 'mtime-before-cutoff';
  readonly scanSafe: boolean;
  readonly candidateCount: number;
  readonly candidateBytes: number;
  readonly protectedScopeCount: number;
  readonly protectedFileCount: number;
  readonly blockerCount: number;
  readonly blockers: readonly StoreEvidenceRetentionPreviewBlocker[];
}
