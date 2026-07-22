export type StoreMigrationStatus = 'started' | 'applied' | 'failed';

export type StoreMigrationQuarantineReason =
  | 'missing_store_identity'
  | 'unsupported_marketplace'
  | 'ambiguous_store_identity'
  | 'missing_parent_store'
  | 'ambiguous_parent_store'
  | 'cross_store_conflict'
  | 'invalid_existing_store_id'
  | 'duplicate_identity'
  | 'identity_content_conflict';

export interface StoreMigrationBackupManifest {
  status: 'pending' | 'created' | 'reused' | 'not_applicable';
  databasePath?: string;
  backupPath?: string;
  integrityCheck: string;
  sha256?: string;
  sizeBytes?: number;
}

export interface StoreMigrationManifest {
  version: number;
  name: string;
  checksum: string;
  startedAt: string;
  schemaFingerprint: string;
  integrityCheck: string;
  tableRowCounts: Record<string, number>;
  targetTables: string[];
  backup: StoreMigrationBackupManifest;
}

export interface StoreMigrationTableResult {
  table: string;
  totalRows: number;
  mappedRows: number;
  quarantinedRows: number;
  storeIdColumnAdded: boolean;
  indexName: string;
  skipped: boolean;
}

export interface StoreMigrationResult {
  version: number;
  name: string;
  status: StoreMigrationStatus;
  startedAt: string;
  finishedAt?: string;
  tableResults: StoreMigrationTableResult[];
  mappedRows: number;
  quarantinedRows: number;
  createdStores: number;
  errorMessage?: string;
}

export interface SchemaMigrationRecord {
  version: number;
  name: string;
  checksum: string;
  status: StoreMigrationStatus;
  startedAt: string;
  appliedAt?: string;
  errorMessage?: string;
  manifest: StoreMigrationManifest;
  result?: StoreMigrationResult;
}

export interface StoreMigrationQuarantineRecord {
  id: number;
  migrationVersion: number;
  sourceTable: string;
  sourceRowId: string;
  reason: StoreMigrationQuarantineReason;
  normalizedStoreName?: string;
  normalizedMarketplaceCode?: string;
  candidateStoreIds: string[];
  sourceIdentity: Record<string, unknown>;
  status: 'pending' | 'resolved';
  resolvedStoreId?: string;
  resolutionNote?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface StoreMigrationRecoveryPreflight {
  version: number;
  canRestore: boolean;
  backupPath?: string;
  backupIntegrityCheck?: string;
  backupSha256?: string;
  blockers: string[];
}

export interface StoreMigrationRestoreResult {
  version: number;
  sourceBackupPath: string;
  destinationPath: string;
  integrityCheck: string;
  sha256: string;
  sizeBytes: number;
}
