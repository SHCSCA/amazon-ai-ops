import { createHash, randomBytes } from 'crypto';
import type { Database } from 'better-sqlite3';
import type {
  AdDailyMetrics,
  LingxingCollectionJobSnapshot,
  LingxingCollectionProgressEvent,
  LingxingCollectionReportCheckpoint,
  LingxingCollectionResumeState,
  LingxingReportBatch,
  LingxingReportFile,
  LingxingReportType,
  StoreId,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  LINGXING_COLLECTION_IMPORT_STATES,
  normalizeStoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  hashCanonicalMetrics,
  readCanonicalMetrics,
} from '../migrations/0010-collection-resume-authority';

const COMPLETE_LINGXING_REPORT_TYPES = new Set<LingxingReportType>([
  'campaign', 'ad_group', 'placement', 'advertised_product',
  'auto_targeting', 'keyword', 'product_targeting', 'user_search_term',
]);

export interface StoreScopedLingxingReportBatch extends LingxingReportBatch {
  storeId: StoreId;
}

export interface StoreScopedLingxingReportFile extends LingxingReportFile {
  storeId: StoreId;
}

export interface LingxingCollectionAuthorityProof {
  job: LingxingCollectionJobSnapshot;
  jobRow: {
    storeId: StoreId;
    jobId: string;
    requestId: string;
    browserProfileId: string;
    marketplace: string;
    currency: string;
    businessTimezone: string;
    businessDate: string;
    sessionGeneration: number;
    dateStart: string;
    dateEnd: string;
    mode: string;
    reportTypesJson: string;
    state: string;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    blockerCode: string | null;
    detail: string | null;
  };
  checkpointCount: number;
  batch?: StoreScopedLingxingReportBatch;
  lingxingFileCount: number;
  lingxingFiles: StoreScopedLingxingReportFile[];
  importRunCount: number;
  importRuns: ReportImportRunRecord[];
  importFileSnapshotCount: number;
  importFileSnapshots: ReportImportFileSnapshotRecord[];
  importedReportFileCount: number;
  importedReportFiles: StoreScopedImportedReportFile[];
  reconciliationRowCount: number;
  reconciliations: ReportImportReconciliationRecord[];
  metricEvidenceCount: number;
  metricEvidence: ReportImportMetricEvidenceRecord[];
}

export interface ReportImportMetricEvidenceRecord {
  storeId: StoreId;
  runId: string;
  batchId: string;
  rowCount: number;
  payloadSha256: string;
  createdAt: string;
}

export interface CollectionInPlaceResumeState extends LingxingCollectionResumeState {
  job: LingxingCollectionJobSnapshot;
  batch: StoreScopedLingxingReportBatch;
  files: StoreScopedLingxingReportFile[];
  expectedJobUpdatedAt: string;
  authorityProofSha256: string;
}

export interface AcquireCollectionResumeClaimInput {
  jobId: string;
  requestId: string;
  expectedJobUpdatedAt: string;
  expectedAuthorityProofSha256: string;
  executionStoreContext: StoreContextEnvelope;
  attemptId?: string;
  claimedAt?: string;
}

export interface CollectionResumeClaim {
  storeId: StoreId;
  attemptId: string;
  jobId: string;
  requestId: string;
  claimToken: string;
  expectedJobUpdatedAt: string;
  expectedAuthorityProofSha256: string;
  version: number;
  claimedAt: string;
}

export interface CommitCollectionResumeProgressInput {
  claim: CollectionResumeClaim;
  event: LingxingCollectionProgressEvent;
}

export interface CommitCollectionResumeRunnerResultInput extends CommitCollectionTerminalInput {
  claim: CollectionResumeClaim;
}

export interface CommitCollectionResumeRunnerResultOutput {
  claim: CollectionResumeClaim;
  result: CollectionTerminalCommitResult;
}

export interface AdvanceCollectionResumeClaimAfterImportInput {
  claim: CollectionResumeClaim;
  advancedAt?: string;
}

export interface FinalizeCollectionResumeAttemptInput {
  claim: CollectionResumeClaim;
  outcome: 'succeeded' | 'failed';
  completedAt?: string;
  detail?: string;
}

export interface InterruptCollectionResumeClaimInput {
  claim: CollectionResumeClaim;
  interruptedAt?: string;
  detail?: string;
}

export interface CollectionResumeAttemptReceipt {
  storeId: StoreId;
  attemptId: string;
  jobId: string;
  requestId: string;
  outcome: 'succeeded' | 'failed' | 'interrupted';
  baseJobUpdatedAt: string;
  finalJobUpdatedAt: string;
  baseAuthorityProofSha256: string;
  finalAuthorityProofSha256: string;
  durableSessionGeneration: number;
  executionSessionGeneration: number;
  executionContextSha256: string;
  claimedAt: string;
  completedAt: string;
  detail?: string;
}

interface ActiveCollectionResumeClaimRow {
  storeId: StoreId;
  jobId: string;
  requestId: string;
  attemptId: string;
  claimTokenSha256: string;
  expectedJobUpdatedAt: string;
  expectedAuthorityProofSha256: string;
  version: number;
  claimedAt: string;
  baseJobUpdatedAt: string;
  baseAuthorityProofSha256: string;
  durableSessionGeneration: number;
  executionSessionGeneration: number;
  executionContextSha256: string;
}

export interface CollectionImportRecoveryCasToken {
  storeId: StoreId;
  jobId: string;
  requestId: string;
  expectedJobUpdatedAt: string;
  expectedImportState: 'pending' | 'failed';
  expectedRunId: string;
  expectedAuthorityProofSha256: string;
}

export interface CompleteRecoveredCollectionImportInput {
  attemptedAt: string;
  completedAt: string;
}

export function fingerprintLingxingCollectionAuthorityProof(
  proof: LingxingCollectionAuthorityProof,
): string {
  const canonical = {
    ...proof,
    job: {
      ...proof.job,
      reports: [...proof.job.reports].sort((left, right) => (
        String(left.reportType).localeCompare(String(right.reportType))
      )),
    },
    lingxingFiles: [...proof.lingxingFiles].sort(compareByStableJson),
    importRuns: [...proof.importRuns].sort(compareByStableJson),
    importFileSnapshots: [...proof.importFileSnapshots].sort(compareByStableJson),
    importedReportFiles: [...proof.importedReportFiles].sort(compareByStableJson),
    reconciliations: [...proof.reconciliations].sort(compareByStableJson),
    metricEvidence: [...proof.metricEvidence].sort(compareByStableJson),
  };
  return createHash('sha256').update(stableJson(canonical)).digest('hex');
}

export function fingerprintCollectionResumeExecutionContext(
  value: StoreContextEnvelope,
): string {
  const normalized = normalizeStoreContextEnvelope(value);
  return createHash('sha256').update(stableJson({
    storeId: normalized.storeId,
    browserProfileId: normalized.browserProfileId,
    marketplace: normalized.marketplace,
    currency: normalized.currency,
    businessTimezone: normalized.businessTimezone,
    businessDate: normalized.businessDate,
    sessionGeneration: normalized.sessionGeneration,
  })).digest('hex');
}

export interface LingxingCollectionSemanticScope {
  storeId: StoreId;
  browserProfileId: string;
  businessDate: string;
  dateStart: string;
  dateEnd: string;
  mode: 'create-and-download';
  reportTypes: readonly LingxingReportType[];
}

type LingxingCollectionAuthorityJobRow =
  LingxingCollectionAuthorityProof['jobRow'] & { snapshotJson: string };

export interface LingxingCollectionSnapshotInput {
  batch: LingxingReportBatch;
  files: readonly LingxingReportFile[];
}

export interface CommitCollectionTerminalInput extends LingxingCollectionSnapshotInput {
  job: LingxingCollectionJobSnapshot;
}

export interface CollectionTerminalCommitResult {
  job: LingxingCollectionJobSnapshot;
  batch: StoreScopedLingxingReportBatch;
  files: StoreScopedLingxingReportFile[];
}

export type RecoverableCollectionImportState = 'pending' | 'failed';

export interface CollectionImportRecoveryCursor {
  updatedAt: string;
  jobId: string;
}

export interface CollectionImportRecoveryPage {
  jobs: LingxingCollectionJobSnapshot[];
  nextCursor?: CollectionImportRecoveryCursor;
}

export interface ListRecoverableCollectionImportsOptions {
  limit?: number;
  cursor?: CollectionImportRecoveryCursor;
  importStates?: readonly RecoverableCollectionImportState[];
}

export interface CancelCollectionJobOptions {
  requestId: string;
  completedAt?: string;
  blockerCode?: string;
  detail?: string;
}

export interface RecoverInterruptedCollectionJobsOptions {
  completedAt?: string;
  blockerCode?: string;
  detail?: string;
}

export interface ReportImportFileInput {
  lingxingFileId?: string;
  reportType: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  importedRows: number;
}

export interface ReportImportReconciliationInput {
  dateStart: string;
  dateEnd: string;
  metricDate: string;
  reportType: string;
  expectedRows: number;
  expectedCost: number;
  tolerance?: number;
}

export interface CommitReportImportInput {
  runId: string;
  idempotencyKey: string;
  batchId: string;
  files: readonly ReportImportFileInput[];
  metrics: readonly AdDailyMetrics[];
  reconciliations: readonly ReportImportReconciliationInput[];
  startedAt?: string;
  completedAt?: string;
}

export interface ReportImportRunRecord {
  storeId: StoreId;
  runId: string;
  idempotencyKey: string;
  inputFingerprint: string;
  batchId: string;
  status: 'completed';
  sourceFileCount: number;
  metricRowCount: number;
  reconciliationCount: number;
  startedAt: string;
  completedAt: string;
  createdAt: string;
}

export interface ReportImportCommitResult {
  run: ReportImportRunRecord;
  deduplicated: boolean;
}

export interface ReportImportFileSnapshotRecord {
  storeId: StoreId;
  snapshotId: string;
  runId: string;
  batchId: string;
  lingxingFileId?: string;
  reportFileId?: number;
  reportType: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  importedRows: number;
  capturedAt: string;
}

export interface StoreScopedImportedReportFile {
  id: number;
  storeId: StoreId;
  batchId: string;
  reportType: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  status: string;
  importedRows: number;
  fileHash?: string;
  importError?: string;
  lastImportedAt?: string;
}

export type StoreScopedImportedAdMetric = AdDailyMetrics & { storeId: StoreId };

export interface ReportImportReconciliationRecord {
  storeId: StoreId;
  reconciliationId: string;
  runId: string;
  batchId: string;
  dateStart: string;
  dateEnd: string;
  metricDate: string;
  reportType: string;
  currency: 'USD';
  expectedRows: number;
  actualRows: number;
  expectedCost: number;
  actualCost: number;
  absoluteCostDelta: number;
  tolerance: number;
  withinTolerance: boolean;
  status: 'matched' | 'mismatch';
  reconciledAt: string;
}

export interface AmountReconciliation {
  expectedAmount1e4: number;
  actualAmount1e4: number;
  absoluteDelta1e4: number;
  tolerance1e4: number;
  withinTolerance: boolean;
}

/**
 * Currency reconciliation uses 1/10,000 USD integer units. This keeps the
 * inclusive USD 0.01 boundary deterministic without binary-float drift.
 */
export function reconcileUsdAmount(
  expected: number,
  actual: number,
  tolerance = 0.01,
): AmountReconciliation {
  const expectedAmount1e4 = amountTo1e4(expected, 'expected');
  const actualAmount1e4 = amountTo1e4(actual, 'actual');
  const tolerance1e4 = amountTo1e4(tolerance, 'tolerance');
  const absoluteDelta1e4 = Math.abs(actualAmount1e4 - expectedAmount1e4);
  return {
    expectedAmount1e4,
    actualAmount1e4,
    absoluteDelta1e4,
    tolerance1e4,
    withinTolerance: absoluteDelta1e4 <= tolerance1e4,
  };
}

/**
 * Store-scoped persistence boundary for collector progress and atomic imports.
 * Live collection rows are mutable checkpoints; completed run/file/reconcile
 * rows are append-only and protected by database triggers.
 */
export class LingxingImportRepository {
  constructor(private readonly db: Database) {}

  upsertCollectionProgressForStore(
    storeId: StoreId,
    event: LingxingCollectionProgressEvent,
  ): LingxingCollectionJobSnapshot {
    requiredText(event.eventId, 'eventId');
    requiredText(event.emittedAt, 'emittedAt');
    return this.upsertCollectionJobSnapshotForStore(storeId, event.job, {
      eventId: event.eventId,
      emittedAt: event.emittedAt,
    });
  }

  upsertCollectionJobSnapshotForStore(
    storeId: StoreId,
    snapshot: LingxingCollectionJobSnapshot,
    event?: { eventId: string; emittedAt: string },
  ): LingxingCollectionJobSnapshot {
    snapshot = normalizeCollectionJobSnapshot(snapshot);
    const persist = this.db.transaction(() => (
      this.persistCollectionJobSnapshotRows(storeId, snapshot, event)
    ));
    return persist.immediate();
  }

  /**
   * Closes only the crash window after one immutable import transaction has
   * committed but the mutable collection job still projects pending/failed.
   * The complete authority proof is re-read and fingerprinted while holding
   * the immediate write transaction, so neither a job write nor appended
   * import evidence can slip between verification and the succeeded write.
   */
  completeRecoveredCollectionImportForStore(
    token: CollectionImportRecoveryCasToken,
    input: CompleteRecoveredCollectionImportInput,
  ): LingxingCollectionJobSnapshot {
    const storeId = requiredText(token.storeId, 'recovery token.storeId') as StoreId;
    const jobId = requiredText(token.jobId, 'recovery token.jobId');
    const requestId = requiredText(token.requestId, 'recovery token.requestId');
    const expectedJobUpdatedAt = canonicalUtcInstant(
      token.expectedJobUpdatedAt,
      'recovery token.expectedJobUpdatedAt',
    );
    const expectedRunId = requiredText(token.expectedRunId, 'recovery token.expectedRunId');
    const expectedAuthorityProofSha256 = requiredSha256(
      token.expectedAuthorityProofSha256,
      'recovery token.expectedAuthorityProofSha256',
    );
    if (token.expectedImportState !== 'pending' && token.expectedImportState !== 'failed') {
      throw new Error('COLLECTION_IMPORT_RECOVERY_CAS_INVALID: expectedImportState 必须是 pending/failed。');
    }
    const attemptedAt = canonicalUtcInstant(input.attemptedAt, 'recovery attemptedAt');
    const completedAt = canonicalUtcInstant(input.completedAt, 'recovery completedAt');

    const complete = this.db.transaction(() => {
      let proof: LingxingCollectionAuthorityProof | undefined;
      try {
        proof = this.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, requestId);
      } catch (error) {
        throw new Error(
          `COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT: authority proof 无法唯一重读：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      const uniqueRun = proof?.importRunCount === 1 && proof.importRuns.length === 1
        ? proof.importRuns[0]
        : undefined;
      if (!proof
        || proof.job.jobId !== jobId
        || proof.job.updatedAt !== expectedJobUpdatedAt
        || proof.job.state !== 'completed'
        || proof.job.importState !== token.expectedImportState
        || uniqueRun?.runId !== expectedRunId
        || fingerprintLingxingCollectionAuthorityProof(proof) !== expectedAuthorityProofSha256) {
        throw new Error(
          'COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT: job 或 immutable import authority proof 已漂移。',
        );
      }
      if (!proof.job.completedAt
        || !proof.job.importAttemptedAt
        || proof.job.importAttemptedAt !== attemptedAt
        || Date.parse(proof.job.completedAt) > Date.parse(attemptedAt)
        || Date.parse(uniqueRun.startedAt) < Date.parse(attemptedAt)
        || Date.parse(uniqueRun.completedAt) > Date.parse(completedAt)
        || Date.parse(uniqueRun.createdAt) > Date.parse(completedAt)
        || Date.parse(proof.job.updatedAt) >= Date.parse(completedAt)) {
        throw new Error(
          'COLLECTION_IMPORT_RECOVERY_CAS_INVALID: recovery succeeded 时间线无效。',
        );
      }

      const {
        importState: _importState,
        importAttemptedAt: _importAttemptedAt,
        importCompletedAt: _importCompletedAt,
        importError: _importError,
        ...base
      } = proof.job;
      const next: LingxingCollectionJobSnapshot = {
        ...base,
        importState: 'succeeded',
        importAttemptedAt: attemptedAt,
        importCompletedAt: completedAt,
        updatedAt: completedAt,
      };
      const saved = this.persistCollectionJobSnapshotRows(storeId, next, {
        eventId: `${jobId}:import-recovery:succeeded`,
        emittedAt: completedAt,
      });
      const finalProof = this.readUniqueCollectionAuthorityProofForStoreByRequestId(
        storeId,
        requestId,
      );
      if (!finalProof || finalProof.job.jobId !== jobId) {
        throw new Error('COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT: succeeded proof 无法回读。');
      }
      this.appendRecoveredSucceededResumeReceiptIfNeeded(
        storeId,
        finalProof,
        completedAt,
        expectedJobUpdatedAt,
      );
      return saved;
    });
    return complete.immediate();
  }

  /**
   * Atomically turns one queued/running job into a durable cancelled terminal.
   * This row is the cancellation tombstone: callers must not acknowledge the
   * operator request until this transaction has committed.
   */
  cancelCollectionJobForStore(
    storeId: StoreId,
    jobId: string,
    options: CancelCollectionJobOptions,
  ): LingxingCollectionJobSnapshot {
    const expectedRequestId = requiredText(options.requestId, 'requestId');
    const cancel = this.db.transaction(() => {
      const current = this.getCollectionJobForStore(storeId, jobId);
      if (!current || current.request.requestId !== expectedRequestId) {
        throw new Error('取消采集的 jobId 与 requestId 未绑定到当前店铺同一任务。');
      }
      if (current.state === 'cancelled') return current;
      if (current.state !== 'queued' && current.state !== 'running') {
        throw new Error(`任务 ${jobId} 已进入 ${current.state}，不能再取消。`);
      }
      return this.persistCollectionJobSnapshotRows(
        storeId,
        cancelledCollectionJobSnapshot(current, {
          completedAt: options.completedAt,
          blockerCode: options.blockerCode ?? 'LINGXING_COLLECTION_CANCELLED_BY_OPERATOR',
          detail: options.detail ?? '运营者已取消本次领星采集。',
        }),
      );
    });
    return cancel.immediate();
  }

  /**
   * A queued/running row cannot have a live runner after the process restarts.
   * Close every such orphan as cancelled before Main starts accepting IPC.
   */
  recoverInterruptedCollectionJobsForStore(
    storeId: StoreId,
    options: RecoverInterruptedCollectionJobsOptions = {},
  ): LingxingCollectionJobSnapshot[] {
    const recover = this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT job_id AS jobId
        FROM lingxing_collection_jobs AS jobs
        WHERE jobs.store_id = ? AND jobs.state IN ('queued', 'running')
          AND NOT EXISTS (
            SELECT 1
            FROM lingxing_collection_resume_active_claims AS claims
            WHERE claims.store_id = jobs.store_id
              AND claims.job_id = jobs.job_id
          )
        ORDER BY jobs.updated_at ASC, jobs.job_id ASC
      `).all(storeId) as Array<{ jobId: string }>;
      return rows.map(({ jobId }) => {
        const current = this.getCollectionJobForStore(storeId, jobId);
        if (!current || (current.state !== 'queued' && current.state !== 'running')) {
          throw new Error(`重启恢复时无法读取非终态采集任务 ${jobId}。`);
        }
        return this.persistCollectionJobSnapshotRows(
          storeId,
          cancelledCollectionJobSnapshot(current, {
            completedAt: options.completedAt,
            blockerCode: options.blockerCode ?? 'LINGXING_COLLECTION_INTERRUPTED_BY_RESTART',
            detail: options.detail ?? '应用重启前采集未形成终态，已安全收口为取消；可由运营者重新发起。',
          }),
        );
      });
    });
    return recover.immediate();
  }

  getCollectionJobForStore(
    storeId: StoreId,
    jobId: string,
  ): LingxingCollectionJobSnapshot | undefined {
    const row = this.db.prepare(`
      SELECT snapshot_json AS snapshotJson
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND job_id = ?
    `).get(storeId, jobId) as { snapshotJson: string } | undefined;
    if (!row) return undefined;
    const snapshot = parseRequiredJson<LingxingCollectionJobSnapshot>(row.snapshotJson, '采集 job 快照');
    const reports = this.db.prepare(`
      SELECT * FROM lingxing_collection_report_checkpoints
      WHERE store_id = ? AND job_id = ?
      ORDER BY report_type
    `).all(storeId, jobId).map(mapCollectionCheckpoint);
    return { ...snapshot, reports };
  }

  listCollectionJobsForStore(
    storeId: StoreId,
    limit = 100,
  ): LingxingCollectionJobSnapshot[] {
    const boundedLimit = boundedPositiveInteger(limit, 100, 1000);
    const rows = this.db.prepare(`
      SELECT job_id AS jobId
      FROM lingxing_collection_jobs
      WHERE store_id = ?
      ORDER BY updated_at DESC, job_id DESC
      LIMIT ?
    `).all(storeId, boundedLimit) as Array<{ jobId: string }>;
    return rows
      .map((row) => this.getCollectionJobForStore(storeId, row.jobId))
      .filter((job): job is LingxingCollectionJobSnapshot => Boolean(job));
  }

  /**
   * Exact scheduler readback boundary. A request id is expected to identify at
   * most one durable job per store. LIMIT 2 is intentional: legacy or corrupt
   * duplicate rows must fail closed instead of silently selecting the newest.
   */
  readUniqueCollectionAuthorityProofForStoreByRequestId(
    storeId: StoreId,
    requestId: string,
  ): LingxingCollectionAuthorityProof | undefined {
    const exactRequestId = requiredText(requestId, 'requestId');
    const read = this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT
          store_id AS storeId,
          job_id AS jobId,
          request_id AS requestId,
          browser_profile_id AS browserProfileId,
          marketplace,
          currency,
          business_timezone AS businessTimezone,
          business_date AS businessDate,
          session_generation AS sessionGeneration,
          date_start AS dateStart,
          date_end AS dateEnd,
          mode,
          report_types_json AS reportTypesJson,
          state,
          snapshot_json AS snapshotJson,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt,
          blocker_code AS blockerCode,
          detail
        FROM lingxing_collection_jobs
        WHERE store_id = ? AND request_id = ?
        ORDER BY updated_at DESC, job_id DESC
        LIMIT 2
      `).all(storeId, exactRequestId) as Array<{
        storeId: StoreId;
        jobId: string;
        requestId: string;
        browserProfileId: string;
        marketplace: string;
        currency: string;
        businessTimezone: string;
        businessDate: string;
        sessionGeneration: number;
        dateStart: string;
        dateEnd: string;
        mode: string;
        reportTypesJson: string;
        state: string;
        snapshotJson: string;
        createdAt: string;
        updatedAt: string;
        completedAt: string | null;
        blockerCode: string | null;
        detail: string | null;
      }>;
      if (rows.length > 1) {
        throw new Error('同一店铺 requestId 对应多个 durable 采集任务，拒绝歧义回读。');
      }
      const row = rows[0];
      if (!row) return undefined;
      return this.readCollectionAuthorityProofForSelectedRow(
        storeId,
        exactRequestId,
        row,
      );
    });
    return read.deferred();
  }

  /**
   * Exact scheduler semantic-scope tombstone lookup. This intentionally has no
   * supporting migration/index in v9: the frozen authority schema is scanned
   * inside one deferred transaction. Every row on the immutable core scope is
   * subjected to the same row/snapshot/checkpoint and timestamp validation as
   * request-id readback before partial report sets are ignored. That ordering
   * prevents a drifted SQL report set from hiding an exact snapshot tombstone.
   */
  inspectUniqueCollectionJobForSemanticScope(
    input: LingxingCollectionSemanticScope,
  ): LingxingCollectionAuthorityProof | undefined {
    const scope = normalizeCollectionSemanticScope(input);
    const read = this.db.transaction(() => {
      const malformedReportSet = this.db.prepare(`
        SELECT job_id AS jobId
        FROM lingxing_collection_jobs
        WHERE store_id = ?
          AND browser_profile_id = ?
          AND marketplace = 'US'
          AND currency = 'USD'
          AND business_timezone = 'America/Los_Angeles'
          AND business_date = ?
          AND date_start = ?
          AND date_end = ?
          AND mode = ?
          AND CASE
            WHEN COALESCE(json_valid(report_types_json), 0) <> 1 THEN 1
            WHEN COALESCE(json_type(report_types_json), '') <> 'array' THEN 1
            ELSE 0
          END = 1
        ORDER BY updated_at DESC, job_id DESC
        LIMIT 1
      `).get(
        scope.storeId,
        scope.browserProfileId,
        scope.businessDate,
        scope.dateStart,
        scope.dateEnd,
        scope.mode,
      ) as { jobId: string } | undefined;
      if (malformedReportSet) {
        throw new Error('exact semantic scope 包含损坏的 durable report-set，拒绝继续采集。');
      }
      const rows = this.db.prepare(`
        SELECT
          store_id AS storeId,
          job_id AS jobId,
          request_id AS requestId,
          browser_profile_id AS browserProfileId,
          marketplace,
          currency,
          business_timezone AS businessTimezone,
          business_date AS businessDate,
          session_generation AS sessionGeneration,
          date_start AS dateStart,
          date_end AS dateEnd,
          mode,
          report_types_json AS reportTypesJson,
          state,
          snapshot_json AS snapshotJson,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt,
          blocker_code AS blockerCode,
          detail
        FROM lingxing_collection_jobs
        WHERE store_id = ?
          AND browser_profile_id = ?
          AND marketplace = 'US'
          AND currency = 'USD'
          AND business_timezone = 'America/Los_Angeles'
          AND business_date = ?
          AND date_start = ?
          AND date_end = ?
          AND mode = ?
        ORDER BY updated_at DESC, job_id DESC
      `).all(
        scope.storeId,
        scope.browserProfileId,
        scope.businessDate,
        scope.dateStart,
        scope.dateEnd,
        scope.mode,
      ) as LingxingCollectionAuthorityJobRow[];
      let exactProof: LingxingCollectionAuthorityProof | undefined;
      for (const row of rows) {
        const proof = this.readCollectionAuthorityProofForSelectedRow(
          scope.storeId,
          row.requestId,
          row,
        );
        const rowReportTypes = parseRequiredJson<unknown>(
          proof.jobRow.reportTypesJson,
          '采集 job SQL report_types_json',
        );
        if (!sameCompleteLingxingReportTypeSet(rowReportTypes)
          && !sameCompleteLingxingReportTypeSet(proof.job.request.reportTypes)) {
          continue;
        }
        assertCollectionAuthorityProofSemanticScope(scope, proof);
        if (exactProof) {
          throw new Error('同一 Store/Profile/businessDate/window/report-set 对应多个 durable 采集任务，拒绝歧义回读。');
        }
        exactProof = proof;
      }
      return exactProof;
    });
    return read.deferred();
  }

  private readCollectionAuthorityProofForSelectedRow(
    storeId: StoreId,
    exactRequestId: string,
    row: LingxingCollectionAuthorityJobRow,
  ): LingxingCollectionAuthorityProof {
    const snapshot = parseRequiredJson<LingxingCollectionJobSnapshot>(
      row.snapshotJson,
      '采集 job 快照',
    );
    const checkpointCount = Number((this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM lingxing_collection_report_checkpoints
      WHERE store_id = ? AND job_id = ?
    `).get(storeId, row.jobId) as { count: number }).count);
    const checkpointRows = this.db.prepare(`
      SELECT *
      FROM lingxing_collection_report_checkpoints
      WHERE store_id = ? AND job_id = ?
      ORDER BY report_type
      LIMIT 10
    `).all(storeId, row.jobId);
    const checkpoints = checkpointRows.map(mapCollectionCheckpoint);
    assertCollectionAuthorityJobRow(
      storeId,
      exactRequestId,
      row,
      snapshot,
      checkpointCount,
      checkpoints,
    );
    const job: LingxingCollectionJobSnapshot = { ...snapshot, reports: checkpoints };

    const batchRow = this.db.prepare(`
      SELECT *
      FROM lingxing_report_batches
      WHERE store_id = ? AND id = ?
    `).get(storeId, row.jobId);
    const batch = batchRow ? mapBatch(batchRow, storeId) : undefined;

    const lingxingFileCount = Number((this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM lingxing_report_files
      WHERE store_id = ? AND batch_id = ?
    `).get(storeId, row.jobId) as { count: number }).count);
    const lingxingFiles = this.db.prepare(`
      SELECT *
      FROM lingxing_report_files
      WHERE store_id = ? AND batch_id = ?
      ORDER BY report_type, id
      LIMIT 10
    `).all(storeId, row.jobId).map((fileRow) => mapLingxingFile(fileRow, storeId));

    const importRunCount = Number((this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM report_import_runs
      WHERE store_id = ? AND batch_id = ? AND status = 'completed'
    `).get(storeId, row.jobId) as { count: number }).count);
    const importRuns = this.db.prepare(`
      SELECT *
      FROM report_import_runs
      WHERE store_id = ? AND batch_id = ? AND status = 'completed'
      ORDER BY completed_at DESC, run_id DESC
      LIMIT 2
    `).all(storeId, row.jobId).map((runRow) => mapRun(runRow, storeId));
    const uniqueRun = importRunCount === 1 ? importRuns[0] : undefined;

    const importFileSnapshotCount = uniqueRun
      ? Number((this.db.prepare(`
          SELECT COUNT(*) AS count
          FROM report_import_file_snapshots
          WHERE store_id = ? AND run_id = ? AND batch_id = ?
        `).get(storeId, uniqueRun.runId, row.jobId) as { count: number }).count)
      : 0;
    const importFileSnapshots = uniqueRun
      ? this.db.prepare(`
          SELECT *
          FROM report_import_file_snapshots
          WHERE store_id = ? AND run_id = ? AND batch_id = ?
          ORDER BY report_type, file_path, snapshot_id
          LIMIT 10
        `).all(storeId, uniqueRun.runId, row.jobId)
          .map((snapshotRow) => mapFileSnapshot(snapshotRow, storeId))
      : [];

    const importedReportFileCount = Number((this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM report_files
      WHERE store_id = ? AND batch_id = ?
    `).get(storeId, row.jobId) as { count: number }).count);
    const importedReportFiles = this.db.prepare(`
      SELECT *
      FROM report_files
      WHERE store_id = ? AND batch_id = ?
      ORDER BY report_type, file_path, id
      LIMIT 10
    `).all(storeId, row.jobId).map((reportFileRow) => (
      mapImportedReportFile(reportFileRow, storeId)
    ));

    const reconciliationRowCount = uniqueRun
      ? Number((this.db.prepare(`
          SELECT COUNT(*) AS count
          FROM report_import_reconciliations
          WHERE store_id = ? AND run_id = ? AND batch_id = ?
        `).get(storeId, uniqueRun.runId, row.jobId) as { count: number }).count)
      : 0;
    const reconciliations = uniqueRun
      ? this.db.prepare(`
          SELECT reconciliation.*,
                 batch.date_start AS reconciliation_date_start,
                 batch.date_end AS reconciliation_date_end
          FROM report_import_reconciliations AS reconciliation
          INNER JOIN lingxing_report_batches AS batch
            ON batch.store_id = reconciliation.store_id
           AND batch.id = reconciliation.batch_id
          WHERE reconciliation.store_id = ?
            AND reconciliation.run_id = ?
            AND reconciliation.batch_id = ?
          ORDER BY reconciliation.metric_date,
                   reconciliation.report_type,
                   reconciliation.reconciliation_id
          LIMIT 10
        `).all(storeId, uniqueRun.runId, row.jobId)
          .map((reconciliationRow) => mapReconciliation(reconciliationRow, storeId))
      : [];

    const metricEvidenceCount = uniqueRun
      ? Number((this.db.prepare(`
          SELECT COUNT(*) AS count
          FROM report_import_metric_evidence
          WHERE store_id = ? AND run_id = ? AND batch_id = ?
        `).get(storeId, uniqueRun.runId, row.jobId) as { count: number }).count)
      : 0;
    const metricEvidence = uniqueRun
      ? this.db.prepare(`
          SELECT store_id AS storeId, run_id AS runId, batch_id AS batchId,
                 row_count AS rowCount, payload_sha256 AS payloadSha256,
                 created_at AS createdAt
          FROM report_import_metric_evidence
          WHERE store_id = ? AND run_id = ? AND batch_id = ?
          ORDER BY run_id
          LIMIT 2
        `).all(storeId, uniqueRun.runId, row.jobId) as ReportImportMetricEvidenceRecord[]
      : [];
    if (uniqueRun) {
      if (metricEvidenceCount !== 1 || metricEvidence.length !== 1) {
        throw new Error('唯一导入运行缺少唯一不可变指标证据，拒绝权威回读。');
      }
      const currentMetrics = readCanonicalMetrics(this.db, storeId, row.jobId);
      const currentPayloadSha256 = hashCanonicalMetrics(currentMetrics);
      if (
        currentMetrics.length !== metricEvidence[0].rowCount
        || currentMetrics.length !== uniqueRun.metricRowCount
        || currentPayloadSha256 !== metricEvidence[0].payloadSha256
      ) {
        throw new Error('当前广告指标与不可变导入证据不一致，拒绝权威回读。');
      }
    }

    const proof: LingxingCollectionAuthorityProof = {
      job,
      jobRow: {
        storeId: row.storeId,
        jobId: row.jobId,
        requestId: row.requestId,
        browserProfileId: row.browserProfileId,
        marketplace: row.marketplace,
        currency: row.currency,
        businessTimezone: row.businessTimezone,
        businessDate: row.businessDate,
        sessionGeneration: row.sessionGeneration,
        dateStart: row.dateStart,
        dateEnd: row.dateEnd,
        mode: row.mode,
        reportTypesJson: row.reportTypesJson,
        state: row.state,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        completedAt: row.completedAt,
        blockerCode: row.blockerCode,
        detail: row.detail,
      },
      checkpointCount,
      ...(batch ? { batch } : {}),
      lingxingFileCount,
      lingxingFiles,
      importRunCount,
      importRuns,
      importFileSnapshotCount,
      importFileSnapshots,
      importedReportFileCount,
      importedReportFiles,
      reconciliationRowCount,
      reconciliations,
      metricEvidenceCount,
      metricEvidence,
    };
    assertCollectionAuthorityProofTimestamps(proof);
    return proof;
  }

  findUniqueCollectionJobForStoreByRequestId(
    storeId: StoreId,
    requestId: string,
  ): LingxingCollectionJobSnapshot | undefined {
    return this.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeId,
      requestId,
    )?.job;
  }

  /**
   * Cursor-paged recovery queue. A terminal job is returned only when a
   * downloaded checkpoint is backed by the matching durable file row. Main
   * still re-verifies the file on disk immediately before parsing it.
   */
  listRecoverableCollectionImportsForStore(
    storeId: StoreId,
    options: ListRecoverableCollectionImportsOptions = {},
  ): CollectionImportRecoveryPage {
    const limit = boundedPositiveInteger(options.limit ?? 50, 50, 200);
    const importStates = [...new Set(options.importStates ?? ['pending', 'failed'])];
    if (
      importStates.length === 0
      || importStates.some((state) => state !== 'pending' && state !== 'failed')
    ) {
      throw new Error('恢复查询仅接受 pending/failed 导入状态。');
    }
    const cursor = options.cursor
      ? {
          updatedAt: requiredText(options.cursor.updatedAt, 'recovery cursor.updatedAt'),
          jobId: requiredText(options.cursor.jobId, 'recovery cursor.jobId'),
        }
      : undefined;
    const statePlaceholders = importStates.map(() => '?').join(', ');
    const cursorClause = cursor
      ? `AND (jobs.updated_at < ? OR (jobs.updated_at = ? AND jobs.job_id < ?))`
      : '';
    const params: unknown[] = [storeId, ...importStates];
    if (cursor) params.push(cursor.updatedAt, cursor.updatedAt, cursor.jobId);
    params.push(limit + 1);
    const rows = this.db.prepare(`
      SELECT jobs.job_id AS jobId, jobs.updated_at AS updatedAt
      FROM lingxing_collection_jobs jobs
      WHERE jobs.store_id = ?
        AND jobs.state IN ('completed', 'completed_with_errors')
        AND jobs.request_id NOT LIKE 'canary:%'
        AND json_extract(jobs.snapshot_json, '$.importState') IN (${statePlaceholders})
        AND EXISTS (
          SELECT 1
          FROM lingxing_collection_report_checkpoints checkpoints
          INNER JOIN lingxing_report_files files
            ON files.store_id = checkpoints.store_id
           AND files.batch_id = checkpoints.job_id
           AND files.report_type = checkpoints.report_type
          WHERE checkpoints.store_id = jobs.store_id
            AND checkpoints.job_id = jobs.job_id
            AND checkpoints.state = 'downloaded'
            AND files.status = 'downloaded'
            AND files.file_path IS NOT NULL
            AND TRIM(files.file_path) <> ''
            AND COALESCE(files.file_size_bytes, 0) > 0
        )
        ${cursorClause}
      ORDER BY jobs.updated_at DESC, jobs.job_id DESC
      LIMIT ?
    `).all(...params) as Array<{ jobId: string; updatedAt: string }>;
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const jobs = pageRows.map((row) => {
      const job = this.getCollectionJobForStore(storeId, row.jobId);
      if (!job) throw new Error(`恢复候选任务 ${row.jobId} 无法按店铺回读。`);
      return job;
    });
    const last = pageRows.at(-1);
    return {
      jobs,
      ...(hasMore && last ? {
        nextCursor: { updatedAt: last.updatedAt, jobId: last.jobId },
      } : {}),
    };
  }

  getCollectionResumeStateForStore(
    storeId: StoreId,
    jobId: string,
  ): LingxingCollectionResumeState | undefined {
    const job = this.getCollectionJobForStore(storeId, jobId);
    if (!job) return undefined;
    return { jobId: job.jobId, request: job.request, reports: job.reports };
  }

  /**
   * Returns a complete, fail-closed same-job resume packet. Unsafe durable
   * states are rejected; crash-safe states are normalized only in the cloned
   * packet and never mutate the original authority row during this read.
   */
  getCollectionInPlaceResumeStateForStore(
    storeId: StoreId,
    jobId: string,
  ): CollectionInPlaceResumeState | undefined {
    const exactJobId = requiredText(jobId, 'jobId');
    const selected = this.db.prepare(`
      SELECT request_id AS requestId
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND job_id = ?
    `).get(storeId, exactJobId) as { requestId: string } | undefined;
    if (!selected) return undefined;
    const proof = this.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeId,
      selected.requestId,
    );
    if (!proof || proof.job.jobId !== exactJobId) {
      throw new Error('续跑任务无法绑定唯一 store/job/request authority proof。');
    }
    const reports = normalizeInPlaceResumeReports(proof);
    if (!proof.batch) throw new Error('原地续跑缺少原始 durable batch。');
    const active = this.db.prepare(`
      SELECT 1 FROM lingxing_collection_resume_active_claims
      WHERE store_id = ? AND job_id = ?
    `).get(storeId, exactJobId);
    if (active) throw new Error('该采集任务已有 active resume claim。');
    const job: LingxingCollectionJobSnapshot = {
      ...proof.job,
      request: {
        ...proof.job.request,
        storeContext: { ...proof.job.request.storeContext },
        reportTypes: [...proof.job.request.reportTypes],
      },
      reports: proof.job.reports.map(cloneCollectionCheckpoint),
    };
    return {
      jobId: job.jobId,
      request: job.request,
      reports,
      job,
      batch: { ...proof.batch },
      files: proof.lingxingFiles.map((file) => ({
        ...file,
        ...(file.attemptErrors ? { attemptErrors: [...file.attemptErrors] } : {}),
      })),
      expectedJobUpdatedAt: proof.job.updatedAt,
      authorityProofSha256: fingerprintLingxingCollectionAuthorityProof(proof),
    };
  }

  acquireCollectionResumeClaimForStore(
    storeId: StoreId,
    input: AcquireCollectionResumeClaimInput,
  ): CollectionResumeClaim {
    const executionContext = normalizeStoreContextEnvelope(input.executionStoreContext);
    const attemptId = safeResumeIdentifier(
      input.attemptId ?? `resume_${randomBytes(16).toString('hex')}`,
      'attemptId',
    );
    const jobId = safeResumeIdentifier(input.jobId, 'jobId');
    const requestId = requiredText(input.requestId, 'requestId');
    const expectedJobUpdatedAt = canonicalUtcInstant(
      input.expectedJobUpdatedAt,
      'expectedJobUpdatedAt',
    );
    const expectedAuthorityProofSha256 = sha256Text(
      input.expectedAuthorityProofSha256,
      'expectedAuthorityProofSha256',
    );
    const claimedAt = input.claimedAt === undefined
      ? canonicalMonotonicAfter(
          new Date().toISOString(),
          expectedJobUpdatedAt,
          'claimedAt',
        )
      : canonicalUtcInstant(input.claimedAt, 'claimedAt');
    if (Date.parse(claimedAt) < Date.parse(expectedJobUpdatedAt)) {
      throw new Error('claimedAt 不能早于 base job.updatedAt。');
    }
    const claim = this.db.transaction(() => {
      const packet = this.getCollectionInPlaceResumeStateForStore(storeId, jobId);
      if (!packet) throw new Error('续跑任务不存在。');
      if (
        packet.request.requestId !== requestId
        || packet.expectedJobUpdatedAt !== expectedJobUpdatedAt
        || packet.authorityProofSha256 !== expectedAuthorityProofSha256
      ) {
        throw new Error('COLLECTION_RESUME_CAS_CONFLICT: durable authority proof 已变化。');
      }
      assertExecutionContextCanResume(packet.request.storeContext, executionContext);
      const rawToken = randomBytes(32).toString('base64url');
      const tokenSha256 = hashOpaqueClaimToken(rawToken);
      const executionContextSha256 = fingerprintCollectionResumeExecutionContext(
        executionContext,
      );
      this.db.prepare(`
        INSERT INTO lingxing_collection_resume_attempts (
          store_id, attempt_id, job_id, request_id,
          base_job_updated_at, base_authority_proof_sha256,
          durable_session_generation, execution_session_generation,
          execution_context_sha256, claimed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        storeId,
        attemptId,
        jobId,
        requestId,
        expectedJobUpdatedAt,
        expectedAuthorityProofSha256,
        packet.request.storeContext.sessionGeneration,
        executionContext.sessionGeneration,
        executionContextSha256,
        claimedAt,
      );
      this.db.prepare(`
        INSERT INTO lingxing_collection_resume_active_claims (
          store_id, job_id, request_id, attempt_id, claim_token_sha256,
          expected_job_updated_at, expected_authority_proof_sha256,
          version, claimed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        storeId,
        jobId,
        requestId,
        attemptId,
        tokenSha256,
        expectedJobUpdatedAt,
        expectedAuthorityProofSha256,
        claimedAt,
        claimedAt,
      );
      this.db.prepare(`
        INSERT INTO lingxing_collection_resume_events (
          store_id, event_id, attempt_id, job_id, request_id, event_kind,
          consumed_claim_token_sha256, next_claim_token_sha256,
          base_job_updated_at, final_job_updated_at,
          base_authority_proof_sha256, final_authority_proof_sha256,
          detail, created_at
        ) VALUES (?, ?, ?, ?, ?, 'claimed', NULL, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        storeId,
        `${attemptId}:claimed`,
        attemptId,
        jobId,
        requestId,
        tokenSha256,
        expectedJobUpdatedAt,
        expectedJobUpdatedAt,
        expectedAuthorityProofSha256,
        expectedAuthorityProofSha256,
        claimedAt,
      );
      return {
        storeId,
        attemptId,
        jobId,
        requestId,
        claimToken: rawToken,
        expectedJobUpdatedAt,
        expectedAuthorityProofSha256,
        version: 1,
        claimedAt,
      } satisfies CollectionResumeClaim;
    });
    try {
      return claim.immediate();
    } catch (error) {
      if (/UNIQUE constraint failed|active resume claim/i.test(errorMessage(error))) {
        throw new Error('COLLECTION_RESUME_CLAIM_CONFLICT: 该任务已有续跑声明。');
      }
      throw error;
    }
  }

  commitCollectionResumeProgressForStore(
    storeId: StoreId,
    input: CommitCollectionResumeProgressInput,
  ): CollectionResumeClaim {
    const commit = this.db.transaction(() => {
      const active = this.assertActiveResumeClaim(storeId, input.claim);
      const proof = this.readUniqueCollectionAuthorityProofForStoreByRequestId(
        storeId,
        active.requestId,
      );
      if (!proof || proof.job.jobId !== active.jobId) {
        throw new Error('COLLECTION_RESUME_CAS_CONFLICT: active claim 无法回读原任务。');
      }
      const currentProofSha256 = fingerprintLingxingCollectionAuthorityProof(proof);
      if (
        proof.job.updatedAt !== active.expectedJobUpdatedAt
        || currentProofSha256 !== active.expectedAuthorityProofSha256
      ) {
        throw new Error('COLLECTION_RESUME_CAS_CONFLICT: progress 前 authority proof 已变化。');
      }
      if (
        input.event.job.jobId !== active.jobId
        || input.event.job.request.requestId !== active.requestId
      ) {
        throw new Error('续跑 progress 不属于 active claim 的原 job/request。');
      }
      const emittedAt = canonicalUtcInstant(input.event.emittedAt, 'resume progress.emittedAt');
      if (input.event.job.updatedAt !== emittedAt
        || Date.parse(emittedAt) <= Date.parse(active.expectedJobUpdatedAt)
        || Date.parse(emittedAt) < Date.parse(active.claimedAt)) {
        throw new Error('续跑 progress 必须以严格递增的 canonical updatedAt 提交。');
      }
      const savedJob = this.persistCollectionJobSnapshotRows(storeId, input.event.job, {
        eventId: input.event.eventId,
        emittedAt,
      });
      const nextProof = this.readUniqueCollectionAuthorityProofForStoreByRequestId(
        storeId,
        active.requestId,
      );
      if (!nextProof || nextProof.job.jobId !== active.jobId) {
        throw new Error('续跑 progress 写入后无法回读 authority proof。');
      }
      const nextAuthorityProofSha256 = fingerprintLingxingCollectionAuthorityProof(nextProof);
      const nextRawToken = randomBytes(32).toString('base64url');
      const nextTokenSha256 = hashOpaqueClaimToken(nextRawToken);
      const changed = this.db.prepare(`
        UPDATE lingxing_collection_resume_active_claims
        SET claim_token_sha256 = ?, expected_job_updated_at = ?,
            expected_authority_proof_sha256 = ?, version = version + 1,
            updated_at = ?
        WHERE store_id = ? AND job_id = ? AND attempt_id = ?
          AND claim_token_sha256 = ? AND version = ?
          AND expected_job_updated_at = ?
          AND expected_authority_proof_sha256 = ?
      `).run(
        nextTokenSha256,
        savedJob.updatedAt,
        nextAuthorityProofSha256,
        emittedAt,
        storeId,
        active.jobId,
        active.attemptId,
        active.claimTokenSha256,
        active.version,
        active.expectedJobUpdatedAt,
        active.expectedAuthorityProofSha256,
      );
      if (changed.changes !== 1) {
        throw new Error('COLLECTION_RESUME_CAS_CONFLICT: progress claim token 已被消费。');
      }
      this.db.prepare(`
        INSERT INTO lingxing_collection_resume_events (
          store_id, event_id, attempt_id, job_id, request_id, event_kind,
          consumed_claim_token_sha256, next_claim_token_sha256,
          base_job_updated_at, final_job_updated_at,
          base_authority_proof_sha256, final_authority_proof_sha256,
          detail, created_at
        ) VALUES (?, ?, ?, ?, ?, 'progress', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        storeId,
        `${active.attemptId}:progress:${active.version}`,
        active.attemptId,
        active.jobId,
        active.requestId,
        active.claimTokenSha256,
        nextTokenSha256,
        active.baseJobUpdatedAt,
        savedJob.updatedAt,
        active.baseAuthorityProofSha256,
        nextAuthorityProofSha256,
        input.event.changedReportType ?? null,
        emittedAt,
      );
      return {
        ...input.claim,
        claimToken: nextRawToken,
        expectedJobUpdatedAt: savedJob.updatedAt,
        expectedAuthorityProofSha256: nextAuthorityProofSha256,
        version: active.version + 1,
      };
    });
    return commit.immediate();
  }

  commitCollectionResumeRunnerResultForStore(
    storeId: StoreId,
    input: CommitCollectionResumeRunnerResultInput,
  ): CommitCollectionResumeRunnerResultOutput {
    const job = normalizeCollectionJobSnapshot(input.job);
    const commit = this.db.transaction(() => {
      const active = this.assertActiveResumeClaim(storeId, input.claim);
      this.assertResumeClaimAuthorityCurrent(storeId, active);
      if (job.jobId !== active.jobId || job.request.requestId !== active.requestId) {
        throw new Error('续跑 runner result 不属于 active claim 的原 job/request。');
      }
      if (
        Date.parse(job.updatedAt) <= Date.parse(active.expectedJobUpdatedAt)
        || Date.parse(job.updatedAt) < Date.parse(active.claimedAt)
      ) {
        throw new Error('续跑 runner result 必须晚于当前 proof 且不早于 claimedAt。');
      }
      const authority = this.getStoreAuthority(storeId);
      validateCollectionTerminalIdentity(storeId, authority, job, input.batch, input.files);
      const savedJob = this.persistCollectionJobSnapshotRows(storeId, job);
      const savedCollection = this.persistCollectionSnapshotRows(storeId, authority, {
        batch: input.batch,
        files: input.files,
      });
      const nextProof = this.readUniqueCollectionAuthorityProofForStoreByRequestId(
        storeId,
        active.requestId,
      );
      if (!nextProof || nextProof.job.jobId !== active.jobId) {
        throw new Error('续跑 runner result 写入后无法回读 authority proof。');
      }
      const finalProofSha256 = fingerprintLingxingCollectionAuthorityProof(nextProof);
      const nextClaim = this.rotateActiveResumeClaim(
        active,
        savedJob.updatedAt,
        finalProofSha256,
        savedJob.updatedAt,
        'runner-result',
      );
      return {
        claim: nextClaim,
        result: {
          job: savedJob,
          batch: savedCollection.batch,
          files: savedCollection.files,
        },
      };
    });
    return commit.immediate();
  }

  advanceCollectionResumeClaimAfterImportForStore(
    storeId: StoreId,
    input: AdvanceCollectionResumeClaimAfterImportInput,
  ): CollectionResumeClaim {
    const advance = this.db.transaction(() => {
      const active = this.assertActiveResumeClaim(storeId, input.claim);
      const proof = this.readUniqueCollectionAuthorityProofForStoreByRequestId(
        storeId,
        active.requestId,
      );
      if (!proof
        || proof.job.jobId !== active.jobId
        || proof.job.updatedAt !== active.expectedJobUpdatedAt
        || proof.job.importState !== 'pending'
        || proof.importRunCount !== 1
        || proof.importRuns.length !== 1
        || proof.metricEvidenceCount !== 1
        || proof.metricEvidence.length !== 1
        || proof.job.state !== 'completed'
        || proof.job.reports.length !== COMPLETE_LINGXING_REPORT_TYPES.size
        || proof.job.reports.some((checkpoint) => checkpoint.state !== 'downloaded')) {
        throw new Error(
          'COLLECTION_RESUME_IMPORT_SUCCESSOR_INVALID: import 后继不是唯一完整权威证据。',
        );
      }
      const currentProofSha256 = fingerprintLingxingCollectionAuthorityProof(proof);
      if (currentProofSha256 === active.expectedAuthorityProofSha256) {
        throw new Error('COLLECTION_RESUME_IMPORT_SUCCESSOR_INVALID: authority proof 未产生导入后继。');
      }
      const advancedAt = canonicalUtcInstant(
        input.advancedAt ?? proof.importRuns[0].createdAt,
        'resume import advancedAt',
      );
      if (Date.parse(advancedAt) < Date.parse(active.expectedJobUpdatedAt)) {
        throw new Error('resume import advancedAt 不能早于当前 job.updatedAt。');
      }
      return this.rotateActiveResumeClaim(
        active,
        proof.job.updatedAt,
        currentProofSha256,
        advancedAt,
        'import-authority-successor',
      );
    });
    return advance.immediate();
  }

  finalizeCollectionResumeAttemptForStore(
    storeId: StoreId,
    input: FinalizeCollectionResumeAttemptInput,
  ): CollectionResumeAttemptReceipt {
    const finalize = this.db.transaction(() => {
      const active = this.assertActiveResumeClaim(storeId, input.claim);
      const proof = this.assertResumeClaimAuthorityCurrent(storeId, active);
      if (input.outcome === 'succeeded') {
        if (
          proof.job.state !== 'completed'
          || proof.job.importState !== 'succeeded'
          || proof.job.reports.length !== COMPLETE_LINGXING_REPORT_TYPES.size
          || proof.job.reports.some((checkpoint) => checkpoint.state !== 'downloaded')
          || proof.lingxingFileCount !== COMPLETE_LINGXING_REPORT_TYPES.size
          || proof.lingxingFiles.length !== COMPLETE_LINGXING_REPORT_TYPES.size
          || proof.batch?.status !== 'completed'
          || proof.importRunCount !== 1
          || proof.metricEvidenceCount !== 1
        ) {
          throw new Error('续跑 succeeded receipt 必须绑定最终导入成功的完整八报表 proof。');
        }
      } else if (
        proof.job.state === 'completed'
        && proof.job.importState !== 'failed'
      ) {
        throw new Error('续跑 failed receipt 必须绑定 collector 或 import 失败终态。');
      }
      const completedAt = canonicalMonotonicAfter(
        input.completedAt ?? new Date().toISOString(),
        latestCanonicalInstant(
          [proof.job.updatedAt, active.claimedAt],
          'resume finalize floor',
        ),
        'resume finalize.completedAt',
      );
      this.appendResumeTerminalEvent(
        active,
        input.outcome,
        proof.job.updatedAt,
        fingerprintLingxingCollectionAuthorityProof(proof),
        completedAt,
        input.detail,
      );
      this.consumeActiveResumeClaim(active);
      return this.requireResumeReceipt(storeId, active.attemptId);
    });
    return finalize.immediate();
  }

  interruptCollectionResumeClaimForStore(
    storeId: StoreId,
    input: InterruptCollectionResumeClaimInput,
  ): CollectionResumeAttemptReceipt {
    const interrupt = this.db.transaction(() => {
      const active = this.assertActiveResumeClaim(storeId, input.claim);
      let proof = this.assertResumeClaimAuthorityCurrent(storeId, active);
      if (Date.parse(proof.job.updatedAt) < Date.parse(active.claimedAt)) {
        const advancedJobAt = canonicalMonotonicAfter(
          input.interruptedAt ?? new Date().toISOString(),
          latestCanonicalInstant(
            [proof.job.updatedAt, active.claimedAt],
            'interrupted job floor',
          ),
          'interrupted job.updatedAt',
        );
        this.persistCollectionJobSnapshotRows(storeId, {
          ...proof.job,
          updatedAt: advancedJobAt,
        });
        proof = this.readUniqueCollectionAuthorityProofForStoreByRequestId(
          storeId,
          active.requestId,
        )!;
      }
      const resumeSucceeded = isFinalSucceededResumeProof(proof);
      const interruptedAt = canonicalMonotonicAfter(
        input.interruptedAt ?? new Date().toISOString(),
        latestCanonicalInstant(
          [proof.job.updatedAt, active.claimedAt],
          'interruptedAt floor',
        ),
        'interruptedAt',
      );
      this.appendResumeTerminalEvent(
        active,
        resumeSucceeded ? 'succeeded' : 'interrupted',
        proof.job.updatedAt,
        fingerprintLingxingCollectionAuthorityProof(proof),
        interruptedAt,
        resumeSucceeded
          ? input.detail ?? 'manual interruption reconciled an already durable succeeded resume'
          : input.detail,
      );
      this.consumeActiveResumeClaim(active);
      return this.requireResumeReceipt(storeId, active.attemptId);
    });
    return interrupt.immediate();
  }

  /**
   * Startup-only recovery. It deliberately requires no raw in-memory token,
   * performs no browser action, closes every orphan claim atomically, and
   * converts uncertain creation into create_unknown instead of retrying it.
   */
  interruptOrphanedCollectionResumeClaimsForStartup(
    interruptedAt = new Date().toISOString(),
  ): CollectionResumeAttemptReceipt[] {
    const requestedInterruptedAt = canonicalUtcInstant(interruptedAt, 'startup interruptedAt');
    const recover = this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT store_id AS storeId, job_id AS jobId, attempt_id AS attemptId
        FROM lingxing_collection_resume_active_claims
        ORDER BY store_id, job_id
      `).all() as Array<{ storeId: StoreId; jobId: string; attemptId: string }>;
      const receipts: CollectionResumeAttemptReceipt[] = [];
      for (const row of rows) {
        const active = this.readActiveResumeClaimByAttempt(row.storeId, row.attemptId);
        if (!active) throw new Error('startup resume claim disappeared inside immediate transaction。');
        const job = this.getCollectionJobForStore(row.storeId, row.jobId);
        if (!job) throw new Error('startup resume claim 原任务不存在。');
        const finalJobAt = canonicalMonotonicAfter(
          requestedInterruptedAt,
          latestCanonicalInstant(
            [job.updatedAt, active.claimedAt],
            'startup final job floor',
          ),
          'startup final job.updatedAt',
        );
        let finalJob = job;
        if (job.state === 'running' || job.state === 'queued') {
          const reports = normalizeInterruptedResumeReports(job.reports, finalJobAt);
          const hasUnknownCreate = reports.some((checkpoint) => checkpoint.state === 'create_unknown');
          finalJob = normalizeCollectionJobSnapshot({
            ...job,
            state: 'failed',
            reports,
            blockerCode: hasUnknownCreate
              ? 'LINGXING_CREATE_OUTCOME_UNKNOWN_AFTER_RESTART'
              : 'LINGXING_RESUME_INTERRUPTED_ON_RESTART',
            detail: hasUnknownCreate
              ? '应用重启时存在未确认的报表创建调用，必须人工核对下载中心。'
              : '应用重启已安全中断原地续跑；需由操作员重新发起。',
            completedAt: finalJobAt,
            updatedAt: finalJobAt,
          });
          this.persistCollectionJobSnapshotRows(row.storeId, finalJob);
        } else if (Date.parse(job.updatedAt) < Date.parse(active.claimedAt)) {
          finalJob = normalizeCollectionJobSnapshot({
            ...job,
            updatedAt: finalJobAt,
          });
          this.persistCollectionJobSnapshotRows(row.storeId, finalJob);
        }
        const proof = this.readUniqueCollectionAuthorityProofForStoreByRequestId(
          row.storeId,
          active.requestId,
        );
        if (!proof || proof.job.jobId !== row.jobId) {
          throw new Error('startup interruption 后无法回读 authority proof。');
        }
        const finalProofSha256 = fingerprintLingxingCollectionAuthorityProof(proof);
        const resumeSucceeded = isFinalSucceededResumeProof(proof);
        const terminalAt = canonicalMonotonicAfter(
          requestedInterruptedAt,
          latestCanonicalInstant(
            [finalJob.updatedAt, active.claimedAt],
            'startup terminal floor',
          ),
          'startup interruptedAt',
        );
        this.appendResumeTerminalEvent(
          active,
          resumeSucceeded ? 'succeeded' : 'interrupted',
          finalJob.updatedAt,
          finalProofSha256,
          terminalAt,
          resumeSucceeded
            ? 'startup finalized an already durable succeeded resume without browser execution'
            : 'startup orphan resume claim interrupted without browser execution',
        );
        this.consumeActiveResumeClaim(active);
        receipts.push(this.requireResumeReceipt(row.storeId, row.attemptId));
      }
      return receipts;
    });
    return recover.immediate();
  }

  readLatestCollectionResumeAttemptReceiptForStore(
    storeId: StoreId,
    jobId: string,
    requestId: string,
  ): CollectionResumeAttemptReceipt | undefined {
    const rows = this.readResumeReceiptRows(
      storeId,
      requiredText(jobId, 'jobId'),
      requiredText(requestId, 'requestId'),
      2,
    );
    if (rows.length > 1
      && rows[0].completedAt === rows[1].completedAt
      && rows[0].attemptId === rows[1].attemptId) {
      throw new Error('续跑 terminal receipt 存在歧义重复。');
    }
    return rows[0];
  }

  readUniqueSucceededCollectionResumeReceiptForStore(
    storeId: StoreId,
    jobId: string,
    requestId: string,
  ): CollectionResumeAttemptReceipt | undefined {
    const rows = this.readResumeReceiptRows(
      storeId,
      requiredText(jobId, 'jobId'),
      requiredText(requestId, 'requestId'),
      2,
      'succeeded',
    );
    if (rows.length > 1) {
      throw new Error('同一原任务存在多个 succeeded resume receipt，拒绝歧义回读。');
    }
    return rows[0];
  }

  findLatestCollectionResumeStateForStore(
    storeId: StoreId,
    requestId: string,
  ): LingxingCollectionResumeState | undefined {
    const row = this.db.prepare(`
      SELECT job_id AS jobId
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND request_id = ?
      ORDER BY updated_at DESC, job_id DESC
      LIMIT 1
    `).get(storeId, requestId) as { jobId: string } | undefined;
    return row ? this.getCollectionResumeStateForStore(storeId, row.jobId) : undefined;
  }

  saveCollectionSnapshotForStore(
    storeId: StoreId,
    input: LingxingCollectionSnapshotInput,
  ): { batch: StoreScopedLingxingReportBatch; files: StoreScopedLingxingReportFile[] } {
    const save = this.db.transaction(() => {
      const authority = this.getWritableStoreAuthority(storeId);
      return this.persistCollectionSnapshotRows(storeId, authority, input);
    });
    return save.immediate();
  }

  commitCollectionTerminalForStore(
    storeId: StoreId,
    input: CommitCollectionTerminalInput,
  ): CollectionTerminalCommitResult {
    const job = normalizeCollectionJobSnapshot(input.job);
    const commit = this.db.transaction(() => {
      const authority = this.getStoreAuthority(storeId);
      const existing = this.getCollectionJobForStore(storeId, job.jobId);
      if (existing?.state === 'cancelled' && job.state !== 'cancelled') {
        throw new Error(`采集 job ${job.jobId} 已持久化取消终态，拒绝覆盖为 ${job.state}。`);
      }
      validateCollectionTerminalIdentity(storeId, authority, job, input.batch, input.files);
      const savedJob = this.persistCollectionJobSnapshotRows(storeId, job);
      const savedCollection = this.persistCollectionSnapshotRows(storeId, authority, {
        batch: input.batch,
        files: input.files,
      });
      return {
        job: savedJob,
        batch: savedCollection.batch,
        files: savedCollection.files,
      };
    });
    return commit.immediate();
  }

  getCollectionSnapshotForStore(
    storeId: StoreId,
    batchId: string,
  ): { batch: StoreScopedLingxingReportBatch; files: StoreScopedLingxingReportFile[] } | undefined {
    const batch = this.db.prepare(`
      SELECT * FROM lingxing_report_batches
      WHERE store_id = ? AND id = ?
    `).get(storeId, batchId);
    if (!batch) return undefined;
    const files = this.db.prepare(`
      SELECT * FROM lingxing_report_files
      WHERE store_id = ? AND batch_id = ?
      ORDER BY report_type, id
    `).all(storeId, batchId);
    return {
      batch: mapBatch(batch, storeId),
      files: files.map((row) => mapLingxingFile(row, storeId)),
    };
  }

  listBatchesForStore(storeId: StoreId, limit = 100): StoreScopedLingxingReportBatch[] {
    const boundedLimit = boundedPositiveInteger(limit, 100, 1000);
    return this.db.prepare(`
      SELECT * FROM lingxing_report_batches
      WHERE store_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(storeId, boundedLimit).map((row) => mapBatch(row, storeId));
  }

  commitImportForStore(
    storeId: StoreId,
    input: CommitReportImportInput,
  ): ReportImportCommitResult {
    const normalizedInput = normalizeCommitInput(input);
    const fingerprint = importFingerprint(normalizedInput);
    const existing = this.findExistingRun(storeId, normalizedInput.runId, normalizedInput.idempotencyKey);
    if (existing) return this.resolveDuplicate(existing, normalizedInput, fingerprint);

    const commit = this.db.transaction((): ReportImportCommitResult => {
      const duplicate = this.findExistingRun(storeId, normalizedInput.runId, normalizedInput.idempotencyKey);
      if (duplicate) return this.resolveDuplicate(duplicate, normalizedInput, fingerprint);
      const authority = this.getWritableStoreAuthority(storeId);
      const batchWindow = this.assertBatchOwnership(storeId, normalizedInput.batchId);
      for (const reconciliation of normalizedInput.reconciliations) {
        if (reconciliation.dateStart !== batchWindow.dateStart
          || reconciliation.dateEnd !== batchWindow.dateEnd
          || reconciliation.metricDate !== batchWindow.dateEnd) {
          throw new Error(
            'IMPORT_RECONCILIATION_WINDOW_MISMATCH: control-total 必须严格绑定批次完整日期窗口，'
            + '且兼容字段 metricDate 必须等于 dateEnd。',
          );
        }
      }

      const now = new Date().toISOString();
      const startedAt = normalizedInput.startedAt ?? now;
      const completedAt = normalizedInput.completedAt
        ?? (Date.parse(now) >= Date.parse(startedAt) ? now : startedAt);
      const createdAt = Date.parse(now) >= Date.parse(completedAt) ? now : completedAt;
      if (Date.parse(startedAt) > Date.parse(completedAt)
        || Date.parse(completedAt) > Date.parse(createdAt)) {
        throw new Error(
          'IMPORT_RUN_TIMELINE_INVALID: 必须满足 startedAt <= completedAt <= createdAt。',
        );
      }
      this.db.prepare(`
        INSERT INTO report_import_runs (
          store_id, run_id, idempotency_key, input_fingerprint, batch_id,
          status, source_file_count, metric_row_count, reconciliation_count,
          started_at, completed_at, created_at
        ) VALUES (
          @storeId, @runId, @idempotencyKey, @inputFingerprint, @batchId,
          'completed', @sourceFileCount, @metricRowCount, @reconciliationCount,
          @startedAt, @completedAt, @createdAt
        )
      `).run({
        storeId,
        runId: normalizedInput.runId,
        idempotencyKey: normalizedInput.idempotencyKey,
        inputFingerprint: fingerprint,
        batchId: normalizedInput.batchId,
        sourceFileCount: normalizedInput.files.length,
        metricRowCount: normalizedInput.metrics.length,
        reconciliationCount: normalizedInput.reconciliations.length,
        startedAt,
        completedAt,
        createdAt,
      });

      normalizedInput.files.forEach((file, index) => {
        const reportFileId = this.upsertReportFileRow(storeId, normalizedInput.batchId, file, completedAt);
        if (file.lingxingFileId) {
          const liveFile = this.db.prepare(`
            SELECT 1 FROM lingxing_report_files
            WHERE store_id = ? AND batch_id = ? AND id = ?
          `).get(storeId, normalizedInput.batchId, file.lingxingFileId);
          if (!liveFile) throw new Error(`领星文件 ${file.lingxingFileId} 不属于当前店铺批次。`);
        }
        const snapshotId = stableId('file', storeId, normalizedInput.runId, String(index), file.fileHash);
        this.db.prepare(`
          INSERT INTO report_import_file_snapshots (
            store_id, snapshot_id, run_id, batch_id, lingxing_file_id, report_file_id,
            report_type, file_path, file_name, file_size_bytes, file_hash,
            imported_rows, captured_at
          ) VALUES (
            @storeId, @snapshotId, @runId, @batchId, @lingxingFileId, @reportFileId,
            @reportType, @filePath, @fileName, @fileSizeBytes, @fileHash,
            @importedRows, @capturedAt
          )
        `).run({
          ...file,
          storeId,
          snapshotId,
          runId: normalizedInput.runId,
          batchId: normalizedInput.batchId,
          reportFileId,
          capturedAt: completedAt,
        });
      });

      const metricIdentities = new Set<string>();
      for (const metric of normalizedInput.metrics) {
        if (metric.date < batchWindow.dateStart || metric.date > batchWindow.dateEnd) {
          throw new Error('广告指标日期超出导入批次授权窗口。');
        }
        const identity = metricIdentity(metric);
        if (metricIdentities.has(identity)) {
          throw new Error('同一导入运行包含重复的广告指标数据粒度，拒绝覆盖后伪造行数。');
        }
        metricIdentities.add(identity);
        this.insertMetricRow(storeId, authority, normalizedInput.batchId, metric);
      }

      assertExactReportImportCoverage(normalizedInput);

      const committedMetrics = readCanonicalMetrics(
        this.db,
        storeId,
        normalizedInput.batchId,
      );
      const expectedMetricPayloadSha256 = hashCanonicalMetrics(normalizedInput.metrics);
      const committedMetricPayloadSha256 = hashCanonicalMetrics(committedMetrics);
      if (
        committedMetrics.length !== normalizedInput.metrics.length
        || committedMetricPayloadSha256 !== expectedMetricPayloadSha256
      ) {
        throw new Error(
          'IMPORT_METRIC_EVIDENCE_MISMATCH: 当前批次广告指标与规范化导入载荷不一致。',
        );
      }
      this.db.prepare(`
        INSERT INTO report_import_metric_evidence (
          store_id, run_id, batch_id, row_count, payload_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        storeId,
        normalizedInput.runId,
        normalizedInput.batchId,
        committedMetrics.length,
        committedMetricPayloadSha256,
        completedAt,
      );

      normalizedInput.reconciliations.forEach((reconciliation, index) => {
        const actualMetrics = normalizedInput.metrics.filter((metric) => (
          metric.date >= reconciliation.dateStart
          && metric.date <= reconciliation.dateEnd
          && String(metric.reportType ?? '') === reconciliation.reportType
        ));
        const amount = reconcileUsdAmount(
          reconciliation.expectedCost,
          actualMetrics.reduce((sum, metric) => sum + metric.cost, 0),
          reconciliation.tolerance,
        );
        const rowsMatch = reconciliation.expectedRows === actualMetrics.length;
        const withinTolerance = rowsMatch && amount.withinTolerance;
        if (!withinTolerance) {
          throw new Error(
            `IMPORT_RECONCILIATION_MISMATCH ${reconciliation.dateStart}..${reconciliation.dateEnd} `
            + `${reconciliation.reportType}: `
            + `rows ${actualMetrics.length}/${reconciliation.expectedRows}, `
            + `cost delta ${(amount.absoluteDelta1e4 / 10_000).toFixed(4)} USD `
            + `exceeds ${(amount.tolerance1e4 / 10_000).toFixed(4)} USD.`,
          );
        }
        this.db.prepare(`
          INSERT INTO report_import_reconciliations (
            store_id, reconciliation_id, run_id, batch_id, metric_date,
            report_type, currency, expected_rows, actual_rows,
            expected_cost_1e4, actual_cost_1e4, absolute_cost_delta_1e4,
            tolerance_1e4, within_tolerance, status, reconciled_at
          ) VALUES (
            @storeId, @reconciliationId, @runId, @batchId, @metricDate,
            @reportType, 'USD', @expectedRows, @actualRows,
            @expectedCost1e4, @actualCost1e4, @absoluteCostDelta1e4,
            @tolerance1e4, @withinTolerance, @status, @reconciledAt
          )
        `).run({
          storeId,
          reconciliationId: stableId('reconcile', storeId, normalizedInput.runId, String(index)),
          runId: normalizedInput.runId,
          batchId: normalizedInput.batchId,
          metricDate: reconciliation.metricDate,
          reportType: reconciliation.reportType,
          expectedRows: reconciliation.expectedRows,
          actualRows: actualMetrics.length,
          expectedCost1e4: amount.expectedAmount1e4,
          actualCost1e4: amount.actualAmount1e4,
          absoluteCostDelta1e4: amount.absoluteDelta1e4,
          tolerance1e4: amount.tolerance1e4,
          withinTolerance: 1,
          status: 'matched',
          reconciledAt: completedAt,
        });
      });

      const run = this.getImportRunForStore(storeId, normalizedInput.runId);
      if (!run) throw new Error('导入事务提交前无法回读不可变运行记录。');
      return { run, deduplicated: false };
    });
    return commit.immediate();
  }

  getImportRunForStore(storeId: StoreId, runId: string): ReportImportRunRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM report_import_runs WHERE store_id = ? AND run_id = ?
    `).get(storeId, runId);
    return row ? mapRun(row, storeId) : undefined;
  }

  listImportRunsForStore(storeId: StoreId, limit = 100): ReportImportRunRecord[] {
    const boundedLimit = boundedPositiveInteger(limit, 100, 1000);
    return this.db.prepare(`
      SELECT * FROM report_import_runs
      WHERE store_id = ?
      ORDER BY completed_at DESC, run_id DESC
      LIMIT ?
    `).all(storeId, boundedLimit).map((row) => mapRun(row, storeId));
  }

  listFileSnapshotsForStore(
    storeId: StoreId,
    runId: string,
  ): ReportImportFileSnapshotRecord[] {
    return this.db.prepare(`
      SELECT * FROM report_import_file_snapshots
      WHERE store_id = ? AND run_id = ?
      ORDER BY report_type, file_path, snapshot_id
    `).all(storeId, runId).map((row) => mapFileSnapshot(row, storeId));
  }

  listReportFilesForStore(
    storeId: StoreId,
    batchId: string,
  ): StoreScopedImportedReportFile[] {
    return this.db.prepare(`
      SELECT * FROM report_files
      WHERE store_id = ? AND batch_id = ?
      ORDER BY report_type, file_path, id
    `).all(storeId, batchId).map((row: any) => ({
      id: row.id,
      storeId,
      batchId: row.batch_id,
      reportType: row.report_type,
      filePath: row.file_path,
      fileName: row.file_name,
      fileSizeBytes: row.file_size,
      status: row.status,
      importedRows: row.imported_rows,
      fileHash: row.file_hash ?? undefined,
      importError: row.import_error ?? undefined,
      lastImportedAt: row.last_imported_at ?? undefined,
    }));
  }

  listAdMetricsForStore(
    storeId: StoreId,
    batchId: string,
  ): StoreScopedImportedAdMetric[] {
    return this.db.prepare(`
      SELECT * FROM ad_daily_metrics
      WHERE store_id = ? AND batch_id = ?
      ORDER BY date, report_type, source_file, source_row, id
    `).all(storeId, batchId).map((row: any) => ({
      id: row.id,
      storeId,
      batchId: row.batch_id,
      reportType: row.report_type ?? undefined,
      portfolioName: row.portfolio_name ?? undefined,
      date: row.date,
      storeName: row.store_name,
      marketplaceCode: row.marketplace_code,
      asin: row.asin,
      msku: row.msku,
      campaignName: row.campaign_name,
      adGroupName: row.ad_group_name,
      targeting: row.targeting,
      searchTerm: row.search_term,
      matchType: row.match_type,
      impressions: row.impressions,
      clicks: row.clicks,
      cost: row.cost,
      orders: row.orders,
      sales: row.sales,
      currency: row.currency ?? 'USD',
      acos: row.acos,
      cpc: row.cpc,
      cvr: row.cvr,
      sourceFile: row.source_file,
      sourceRow: row.source_row ?? undefined,
      createdAt: row.created_at,
    }));
  }

  listReconciliationsForStore(
    storeId: StoreId,
    runId: string,
  ): ReportImportReconciliationRecord[] {
    return this.db.prepare(`
      SELECT reconciliation.*,
             batch.date_start AS reconciliation_date_start,
             batch.date_end AS reconciliation_date_end
      FROM report_import_reconciliations AS reconciliation
      INNER JOIN lingxing_report_batches AS batch
        ON batch.store_id = reconciliation.store_id
       AND batch.id = reconciliation.batch_id
      WHERE reconciliation.store_id = ? AND reconciliation.run_id = ?
      ORDER BY reconciliation.metric_date,
               reconciliation.report_type,
               reconciliation.reconciliation_id
    `).all(storeId, runId).map((row) => mapReconciliation(row, storeId));
  }

  private readActiveResumeClaimByAttempt(
    storeId: StoreId,
    attemptId: string,
  ): ActiveCollectionResumeClaimRow | undefined {
    return this.db.prepare(`
      SELECT claims.store_id AS storeId,
             claims.job_id AS jobId,
             claims.request_id AS requestId,
             claims.attempt_id AS attemptId,
             claims.claim_token_sha256 AS claimTokenSha256,
             claims.expected_job_updated_at AS expectedJobUpdatedAt,
             claims.expected_authority_proof_sha256 AS expectedAuthorityProofSha256,
             claims.version,
             claims.claimed_at AS claimedAt,
             attempts.base_job_updated_at AS baseJobUpdatedAt,
             attempts.base_authority_proof_sha256 AS baseAuthorityProofSha256,
             attempts.durable_session_generation AS durableSessionGeneration,
             attempts.execution_session_generation AS executionSessionGeneration,
             attempts.execution_context_sha256 AS executionContextSha256
      FROM lingxing_collection_resume_active_claims AS claims
      INNER JOIN lingxing_collection_resume_attempts AS attempts
        ON attempts.store_id = claims.store_id
       AND attempts.attempt_id = claims.attempt_id
       AND attempts.job_id = claims.job_id
       AND attempts.request_id = claims.request_id
      WHERE claims.store_id = ? AND claims.attempt_id = ?
    `).get(storeId, attemptId) as ActiveCollectionResumeClaimRow | undefined;
  }

  private assertActiveResumeClaim(
    storeId: StoreId,
    claim: CollectionResumeClaim,
  ): ActiveCollectionResumeClaimRow {
    if (claim.storeId !== storeId) {
      throw new Error('resume claim storeId 与调用边界不一致。');
    }
    const active = this.readActiveResumeClaimByAttempt(
      storeId,
      safeResumeIdentifier(claim.attemptId, 'claim.attemptId'),
    );
    if (!active
      || active.jobId !== claim.jobId
      || active.requestId !== claim.requestId
      || active.version !== claim.version
      || active.expectedJobUpdatedAt !== claim.expectedJobUpdatedAt
      || active.expectedAuthorityProofSha256 !== claim.expectedAuthorityProofSha256
      || active.claimedAt !== claim.claimedAt
      || active.claimTokenSha256 !== hashOpaqueClaimToken(claim.claimToken)) {
      throw new Error('COLLECTION_RESUME_CAS_CONFLICT: claim token 已失效或被消费。');
    }
    return active;
  }

  private assertResumeClaimAuthorityCurrent(
    storeId: StoreId,
    active: ActiveCollectionResumeClaimRow,
  ): LingxingCollectionAuthorityProof {
    const proof = this.readUniqueCollectionAuthorityProofForStoreByRequestId(
      storeId,
      active.requestId,
    );
    if (!proof
      || proof.job.jobId !== active.jobId
      || proof.job.updatedAt !== active.expectedJobUpdatedAt
      || fingerprintLingxingCollectionAuthorityProof(proof)
        !== active.expectedAuthorityProofSha256) {
      throw new Error('COLLECTION_RESUME_CAS_CONFLICT: active authority proof 已漂移。');
    }
    return proof;
  }

  private appendResumeTerminalEvent(
    active: ActiveCollectionResumeClaimRow,
    outcome: 'succeeded' | 'failed' | 'interrupted',
    finalJobUpdatedAt: string,
    finalAuthorityProofSha256: string,
    completedAt: string,
    detail?: string,
  ): void {
    this.db.prepare(`
      INSERT INTO lingxing_collection_resume_events (
        store_id, event_id, attempt_id, job_id, request_id, event_kind,
        consumed_claim_token_sha256, next_claim_token_sha256,
        base_job_updated_at, final_job_updated_at,
        base_authority_proof_sha256, final_authority_proof_sha256,
        detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      active.storeId,
      `${active.attemptId}:${outcome}`,
      active.attemptId,
      active.jobId,
      active.requestId,
      outcome,
      active.claimTokenSha256,
      active.baseJobUpdatedAt,
      finalJobUpdatedAt,
      active.baseAuthorityProofSha256,
      sha256Text(finalAuthorityProofSha256, 'finalAuthorityProofSha256'),
      detail ? String(detail).slice(0, 2_000) : null,
      completedAt,
    );
  }

  private rotateActiveResumeClaim(
    active: ActiveCollectionResumeClaimRow,
    finalJobUpdatedAt: string,
    finalAuthorityProofSha256: string,
    createdAt: string,
    detail: string,
  ): CollectionResumeClaim {
    const nextRawToken = randomBytes(32).toString('base64url');
    const nextTokenSha256 = hashOpaqueClaimToken(nextRawToken);
    const exactProofSha256 = sha256Text(
      finalAuthorityProofSha256,
      'finalAuthorityProofSha256',
    );
    const changed = this.db.prepare(`
      UPDATE lingxing_collection_resume_active_claims
      SET claim_token_sha256 = ?, expected_job_updated_at = ?,
          expected_authority_proof_sha256 = ?, version = version + 1,
          updated_at = ?
      WHERE store_id = ? AND job_id = ? AND attempt_id = ?
        AND claim_token_sha256 = ? AND version = ?
        AND expected_job_updated_at = ?
        AND expected_authority_proof_sha256 = ?
    `).run(
      nextTokenSha256,
      finalJobUpdatedAt,
      exactProofSha256,
      createdAt,
      active.storeId,
      active.jobId,
      active.attemptId,
      active.claimTokenSha256,
      active.version,
      active.expectedJobUpdatedAt,
      active.expectedAuthorityProofSha256,
    );
    if (changed.changes !== 1) {
      throw new Error('COLLECTION_RESUME_CAS_CONFLICT: claim rotation failed。');
    }
    this.db.prepare(`
      INSERT INTO lingxing_collection_resume_events (
        store_id, event_id, attempt_id, job_id, request_id, event_kind,
        consumed_claim_token_sha256, next_claim_token_sha256,
        base_job_updated_at, final_job_updated_at,
        base_authority_proof_sha256, final_authority_proof_sha256,
        detail, created_at
      ) VALUES (?, ?, ?, ?, ?, 'progress', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      active.storeId,
      `${active.attemptId}:progress:${active.version}`,
      active.attemptId,
      active.jobId,
      active.requestId,
      active.claimTokenSha256,
      nextTokenSha256,
      active.baseJobUpdatedAt,
      finalJobUpdatedAt,
      active.baseAuthorityProofSha256,
      exactProofSha256,
      detail,
      createdAt,
    );
    return {
      storeId: active.storeId,
      attemptId: active.attemptId,
      jobId: active.jobId,
      requestId: active.requestId,
      claimToken: nextRawToken,
      expectedJobUpdatedAt: finalJobUpdatedAt,
      expectedAuthorityProofSha256: exactProofSha256,
      version: active.version + 1,
      claimedAt: active.claimedAt,
    };
  }

  private consumeActiveResumeClaim(active: ActiveCollectionResumeClaimRow): void {
    const removed = this.db.prepare(`
      DELETE FROM lingxing_collection_resume_active_claims
      WHERE store_id = ? AND job_id = ? AND attempt_id = ?
        AND claim_token_sha256 = ? AND version = ?
    `).run(
      active.storeId,
      active.jobId,
      active.attemptId,
      active.claimTokenSha256,
      active.version,
    );
    if (removed.changes !== 1) {
      throw new Error('COLLECTION_RESUME_CAS_CONFLICT: terminal claim token 已被消费。');
    }
  }

  private readResumeReceiptRows(
    storeId: StoreId,
    jobId: string,
    requestId: string,
    limit: number,
    outcome?: 'succeeded',
  ): CollectionResumeAttemptReceipt[] {
    const outcomeClause = outcome ? 'AND events.event_kind = ?' : `AND events.event_kind IN (
      'succeeded', 'failed', 'interrupted'
    )`;
    const params: unknown[] = [storeId, jobId, requestId];
    if (outcome) params.push(outcome);
    params.push(limit);
    return (this.db.prepare(`
      SELECT events.store_id AS storeId,
             events.attempt_id AS attemptId,
             events.job_id AS jobId,
             events.request_id AS requestId,
             events.event_kind AS outcome,
             events.base_job_updated_at AS baseJobUpdatedAt,
             events.final_job_updated_at AS finalJobUpdatedAt,
             events.base_authority_proof_sha256 AS baseAuthorityProofSha256,
             events.final_authority_proof_sha256 AS finalAuthorityProofSha256,
             attempts.durable_session_generation AS durableSessionGeneration,
             attempts.execution_session_generation AS executionSessionGeneration,
             attempts.execution_context_sha256 AS executionContextSha256,
             attempts.claimed_at AS claimedAt,
             events.created_at AS completedAt,
             events.detail
      FROM lingxing_collection_resume_events AS events
      INNER JOIN lingxing_collection_resume_attempts AS attempts
        ON attempts.store_id = events.store_id
       AND attempts.attempt_id = events.attempt_id
       AND attempts.job_id = events.job_id
       AND attempts.request_id = events.request_id
       AND attempts.base_job_updated_at = events.base_job_updated_at
       AND attempts.base_authority_proof_sha256 = events.base_authority_proof_sha256
      WHERE events.store_id = ? AND events.job_id = ? AND events.request_id = ?
        ${outcomeClause}
      ORDER BY events.created_at DESC, events.event_id DESC
      LIMIT ?
    `).all(...params) as Array<CollectionResumeAttemptReceipt & { detail: string | null }>)
      .map((row) => ({
        ...row,
        ...(row.detail ? { detail: row.detail } : {}),
      }));
  }

  private requireResumeReceipt(
    storeId: StoreId,
    attemptId: string,
  ): CollectionResumeAttemptReceipt {
    const row = this.db.prepare(`
      SELECT job_id AS jobId, request_id AS requestId
      FROM lingxing_collection_resume_attempts
      WHERE store_id = ? AND attempt_id = ?
    `).get(storeId, attemptId) as { jobId: string; requestId: string } | undefined;
    if (!row) throw new Error('resume receipt attempt 不存在。');
    const receipt = this.readResumeReceiptRows(
      storeId,
      row.jobId,
      row.requestId,
      100,
    ).find((candidate) => candidate.attemptId === attemptId);
    if (!receipt) throw new Error('resume terminal receipt 写入后无法回读。');
    return receipt;
  }

  private appendRecoveredSucceededResumeReceiptIfNeeded(
    storeId: StoreId,
    proof: LingxingCollectionAuthorityProof,
    completedAt: string,
    predecessorJobUpdatedAt: string,
  ): void {
    if (!isFinalSucceededResumeProof(proof)) return;
    const rows = this.db.prepare(`
      SELECT attempts.attempt_id AS attemptId,
             attempts.job_id AS jobId,
             attempts.request_id AS requestId,
             attempts.base_job_updated_at AS baseJobUpdatedAt,
             attempts.base_authority_proof_sha256 AS baseAuthorityProofSha256
      FROM lingxing_collection_resume_attempts AS attempts
      INNER JOIN lingxing_collection_resume_events AS terminal
        ON terminal.store_id = attempts.store_id
       AND terminal.attempt_id = attempts.attempt_id
       AND terminal.job_id = attempts.job_id
       AND terminal.request_id = attempts.request_id
       AND terminal.event_kind IN ('interrupted', 'failed')
      WHERE attempts.store_id = ?
        AND attempts.job_id = ?
        AND attempts.request_id = ?
        AND terminal.final_job_updated_at IN (?, ?, ?)
        AND NOT EXISTS (
          SELECT 1 FROM lingxing_collection_resume_events AS succeeded
          WHERE succeeded.store_id = attempts.store_id
            AND succeeded.attempt_id = attempts.attempt_id
            AND succeeded.event_kind = 'succeeded'
        )
        AND NOT EXISTS (
          SELECT 1 FROM lingxing_collection_resume_active_claims AS active
          WHERE active.store_id = attempts.store_id
            AND active.attempt_id = attempts.attempt_id
        )
      ORDER BY attempts.claimed_at DESC, attempts.attempt_id DESC
      LIMIT 2
    `).all(
      storeId,
      proof.job.jobId,
      proof.job.request.requestId,
      proof.job.completedAt,
      proof.job.importAttemptedAt,
      predecessorJobUpdatedAt,
    ) as Array<{
      attemptId: string;
      jobId: string;
      requestId: string;
      baseJobUpdatedAt: string;
      baseAuthorityProofSha256: string;
    }>;
    if (rows.length > 1) {
      throw new Error('import recovery 对应多个 resume terminal predecessor，拒绝追加成功后继。');
    }
    const attempt = rows[0];
    if (!attempt) return;
    this.db.prepare(`
      INSERT INTO lingxing_collection_resume_events (
        store_id, event_id, attempt_id, job_id, request_id, event_kind,
        consumed_claim_token_sha256, next_claim_token_sha256,
        base_job_updated_at, final_job_updated_at,
        base_authority_proof_sha256, final_authority_proof_sha256,
        detail, created_at
      ) VALUES (?, ?, ?, ?, ?, 'succeeded', NULL, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      storeId,
      `${attempt.attemptId}:recovered-succeeded`,
      attempt.attemptId,
      attempt.jobId,
      attempt.requestId,
      attempt.baseJobUpdatedAt,
      proof.job.updatedAt,
      attempt.baseAuthorityProofSha256,
      fingerprintLingxingCollectionAuthorityProof(proof),
      'append-only successor: interrupted resume completed through exact import recovery CAS',
      completedAt,
    );
  }

  private persistCollectionJobSnapshotRows(
    storeId: StoreId,
    snapshot: LingxingCollectionJobSnapshot,
    event?: { eventId: string; emittedAt: string },
  ): LingxingCollectionJobSnapshot {
    const authority = this.getStoreAuthority(storeId);
    validateCollectionJobSnapshot(storeId, authority, snapshot);
    validateCollectionLineage(this.db, storeId, snapshot);
    const existing = this.db.prepare(`
      SELECT request_id AS requestId, browser_profile_id AS browserProfileId,
             session_generation AS sessionGeneration, date_start AS dateStart,
             date_end AS dateEnd, mode, report_types_json AS reportTypesJson,
             snapshot_json AS snapshotJson, updated_at AS updatedAt
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND job_id = ?
    `).get(storeId, snapshot.jobId) as {
      requestId: string;
      browserProfileId: string;
      sessionGeneration: number;
      dateStart: string;
      dateEnd: string;
      mode: string;
      reportTypesJson: string;
      snapshotJson: string;
      updatedAt: string;
    } | undefined;
    const reportTypesJson = JSON.stringify(snapshot.request.reportTypes);
    const existingSnapshot = existing
      ? parseRequiredJson<LingxingCollectionJobSnapshot>(existing.snapshotJson, '既有采集 job 快照')
      : undefined;
    if (existing && (
      existing.requestId !== snapshot.request.requestId
      || existing.browserProfileId !== String(snapshot.request.storeContext.browserProfileId)
      || existing.sessionGeneration !== Number(snapshot.request.storeContext.sessionGeneration)
      || existing.dateStart !== snapshot.request.dateStart
      || existing.dateEnd !== snapshot.request.dateEnd
      || existing.mode !== snapshot.request.mode
      || existing.reportTypesJson !== reportTypesJson
      || (existingSnapshot?.lineage !== undefined
        && stableJson(existingSnapshot.lineage) !== stableJson(snapshot.lineage))
    )) {
      throw new Error('采集 jobId 已绑定不同的店铺权威请求，拒绝覆盖。');
    }
    // A durable cancellation is monotonic. Progress already queued by the
    // runner may arrive after the operator cancellation transaction, but it
    // must never resurrect the job as running (or complete it normally).
    if (existingSnapshot?.state === 'cancelled' && snapshot.state !== 'cancelled') {
      const durableCancelled = this.getCollectionJobForStore(storeId, snapshot.jobId);
      if (!durableCancelled) throw new Error('已取消采集任务无法按店铺回读。');
      return durableCancelled;
    }
    // A runner-produced cancelled terminal can legitimately be older than the
    // cancellation tombstone written by IPC. Keep the newer durable truth and
    // still allow the outer terminal transaction to persist batch/file proof.
    if (existing && existingSnapshot?.state === 'cancelled' && snapshot.state === 'cancelled'
      && existing.updatedAt >= snapshot.updatedAt) {
      const durableCancelled = this.getCollectionJobForStore(storeId, snapshot.jobId);
      if (!durableCancelled) throw new Error('已取消采集任务无法按店铺回读。');
      return durableCancelled;
    }
    const snapshotJson = stableJson(snapshot);
    if (existing && existing.updatedAt > snapshot.updatedAt) {
      throw new Error('采集进度快照早于已持久化状态，拒绝回退。');
    }
    if (existing && existing.updatedAt === snapshot.updatedAt && existing.snapshotJson !== snapshotJson) {
      throw new Error('相同 updatedAt 对应不同采集快照，拒绝非确定性覆盖。');
    }

    this.db.prepare(`
      INSERT INTO lingxing_collection_jobs (
        store_id, job_id, request_id, browser_profile_id, marketplace,
        currency, business_timezone, business_date, session_generation,
        date_start, date_end, mode, report_types_json, state, snapshot_json,
        last_event_id, last_event_emitted_at, created_at, updated_at,
        completed_at, blocker_code, detail
      ) VALUES (
        @storeId, @jobId, @requestId, @browserProfileId, 'US',
        'USD', @businessTimezone, @businessDate, @sessionGeneration,
        @dateStart, @dateEnd, @mode, @reportTypesJson, @state, @snapshotJson,
        @lastEventId, @lastEventEmittedAt, @createdAt, @updatedAt,
        @completedAt, @blockerCode, @detail
      )
      ON CONFLICT(store_id, job_id) DO UPDATE SET
        state = excluded.state,
        snapshot_json = excluded.snapshot_json,
        last_event_id = COALESCE(excluded.last_event_id, lingxing_collection_jobs.last_event_id),
        last_event_emitted_at = COALESCE(
          excluded.last_event_emitted_at,
          lingxing_collection_jobs.last_event_emitted_at
        ),
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        blocker_code = excluded.blocker_code,
        detail = excluded.detail
    `).run({
      storeId,
      jobId: snapshot.jobId,
      requestId: snapshot.request.requestId,
      browserProfileId: String(snapshot.request.storeContext.browserProfileId),
      businessTimezone: snapshot.request.storeContext.businessTimezone,
      businessDate: String(snapshot.request.storeContext.businessDate),
      sessionGeneration: Number(snapshot.request.storeContext.sessionGeneration),
      dateStart: snapshot.request.dateStart,
      dateEnd: snapshot.request.dateEnd,
      mode: snapshot.request.mode,
      reportTypesJson,
      state: snapshot.state,
      snapshotJson,
      lastEventId: event?.eventId ?? null,
      lastEventEmittedAt: event?.emittedAt ?? null,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      completedAt: snapshot.completedAt ?? null,
      blockerCode: snapshot.blockerCode ?? null,
      detail: snapshot.detail ?? null,
    });

    if (snapshot.reports.length === 0) {
      this.db.prepare(`
        DELETE FROM lingxing_collection_report_checkpoints
        WHERE store_id = ? AND job_id = ?
      `).run(storeId, snapshot.jobId);
    } else {
      const reportTypes = snapshot.reports.map((checkpoint) => checkpoint.reportType);
      this.db.prepare(`
        DELETE FROM lingxing_collection_report_checkpoints
        WHERE store_id = ? AND job_id = ?
          AND report_type NOT IN (${reportTypes.map(() => '?').join(', ')})
      `).run(storeId, snapshot.jobId, ...reportTypes);
    }
    for (const checkpoint of snapshot.reports) {
      this.upsertCollectionCheckpoint(storeId, snapshot.jobId, checkpoint);
    }
    const saved = this.getCollectionJobForStore(storeId, snapshot.jobId);
    if (!saved) throw new Error('采集进度写入后无法按店铺回读。');
    return saved;
  }

  private persistCollectionSnapshotRows(
    storeId: StoreId,
    authority: StoreAuthority,
    input: LingxingCollectionSnapshotInput,
  ): { batch: StoreScopedLingxingReportBatch; files: StoreScopedLingxingReportFile[] } {
    this.assertBatchInput(storeId, authority, input.batch);
    this.upsertBatchRow(storeId, input.batch);
    for (const file of input.files) {
      if (file.batchId !== input.batch.id) {
        throw new Error(`领星文件 ${file.id} 的 batchId 与批次 ${input.batch.id} 不一致。`);
      }
      this.upsertLingxingFileRow(storeId, file);
    }
    const saved = this.getCollectionSnapshotForStore(storeId, input.batch.id);
    if (!saved) throw new Error('领星采集快照写入后无法按店铺回读。');
    return saved;
  }

  private getWritableStoreAuthority(storeId: StoreId): StoreAuthority {
    const row = this.getStoreAuthority(storeId);
    if (row.status !== 'active') throw new Error(`店铺 ${storeId} 当前状态为 ${row.status}，禁止写入。`);
    return row;
  }

  private getStoreAuthority(storeId: StoreId): StoreAuthority {
    const row = this.db.prepare(`
      SELECT display_name AS displayName, marketplace, currency, status
           , browser_profile_id AS browserProfileId,
             business_timezone AS businessTimezone
      FROM stores WHERE store_id = ?
    `).get(storeId) as StoreAuthority | undefined;
    if (!row) throw new Error(`未知店铺 ${storeId}。`);
    if (row.marketplace !== 'US' || row.currency !== 'USD') {
      throw new Error(`店铺 ${storeId} 不是 Amazon US / USD 权威数据域。`);
    }
    return row;
  }

  private upsertCollectionCheckpoint(
    storeId: StoreId,
    jobId: string,
    checkpoint: LingxingCollectionReportCheckpoint,
  ): void {
    this.db.prepare(`
      INSERT INTO lingxing_collection_report_checkpoints (
        store_id, job_id, report_type, state, attempt_index,
        auto_retry_count, created_report_identity_json, file_size_bytes,
        error_code, detail, updated_at
      ) VALUES (
        @storeId, @jobId, @reportType, @state, @attemptIndex,
        @autoRetryCount, @createdReportIdentityJson, @fileSizeBytes,
        @errorCode, @detail, @updatedAt
      )
      ON CONFLICT(store_id, job_id, report_type) DO UPDATE SET
        state = excluded.state,
        attempt_index = excluded.attempt_index,
        auto_retry_count = excluded.auto_retry_count,
        created_report_identity_json = excluded.created_report_identity_json,
        file_size_bytes = excluded.file_size_bytes,
        error_code = excluded.error_code,
        detail = excluded.detail,
        updated_at = excluded.updated_at
    `).run({
      storeId,
      jobId,
      reportType: checkpoint.reportType,
      state: checkpoint.state,
      attemptIndex: checkpoint.attemptIndex,
      autoRetryCount: checkpoint.autoRetryCount,
      createdReportIdentityJson: checkpoint.createdReportIdentity
        ? stableJson(checkpoint.createdReportIdentity)
        : null,
      fileSizeBytes: checkpoint.fileSizeBytes ?? null,
      errorCode: checkpoint.errorCode ?? null,
      detail: checkpoint.detail ?? null,
      updatedAt: checkpoint.updatedAt,
    });
  }

  private assertBatchInput(storeId: StoreId, authority: StoreAuthority, batch: LingxingReportBatch): void {
    requiredText(batch.id, 'batch.id');
    if (batch.storeId && String(batch.storeId) !== String(storeId)) {
      throw new Error('领星批次 storeId 与当前权威店铺不一致。');
    }
    if (batch.browserProfileId && String(batch.browserProfileId) !== authority.browserProfileId) {
      throw new Error('领星批次 browserProfileId 与当前权威店铺不一致。');
    }
    if (batch.sessionGeneration !== undefined
      && (!Number.isSafeInteger(Number(batch.sessionGeneration)) || Number(batch.sessionGeneration) < 0)) {
      throw new Error('领星批次 sessionGeneration 无效。');
    }
    if (batch.storeName && normalizeIdentity(batch.storeName) !== normalizeIdentity(authority.displayName)) {
      throw new Error('领星批次店铺名称与 store_id 的权威记录不一致。');
    }
    if (batch.marketplaceCode && batch.marketplaceCode.trim().toUpperCase() !== authority.marketplace) {
      throw new Error('领星批次站点与 store_id 的权威记录不一致。');
    }
  }

  private upsertBatchRow(storeId: StoreId, batch: LingxingReportBatch): void {
    const existing = this.db.prepare(`
      SELECT store_id AS storeId,
             request_id AS requestId,
             browser_profile_id AS browserProfileId,
             business_date AS businessDate,
             session_generation AS sessionGeneration,
             app_version AS appVersion,
             date_start AS dateStart,
             date_end AS dateEnd,
             store_name AS storeName,
             marketplace_code AS marketplaceCode,
             status,
             download_dir AS downloadDir,
             manifest_path AS manifestPath,
             created_at AS createdAt,
             completed_at AS completedAt,
             EXISTS(
               SELECT 1 FROM report_import_runs AS run
               WHERE run.store_id = lingxing_report_batches.store_id
                 AND run.batch_id = lingxing_report_batches.id
             ) AS hasCommittedImport
      FROM lingxing_report_batches
      WHERE id = ?
    `).get(batch.id) as {
      storeId?: string | null;
      requestId?: string | null;
      browserProfileId?: string | null;
      businessDate?: string | null;
      sessionGeneration?: number | null;
      appVersion?: string | null;
      dateStart: string;
      dateEnd: string;
      storeName?: string | null;
      marketplaceCode?: string | null;
      status: string;
      downloadDir: string;
      manifestPath?: string | null;
      createdAt: string;
      completedAt?: string | null;
      hasCommittedImport: number;
    } | undefined;
    if (existing && existing.storeId !== storeId) {
      throw new Error(`领星批次 ${batch.id} 已属于其他店铺或尚未完成归属确认。`);
    }
    const next = {
      requestId: batch.requestId ?? null,
      browserProfileId: batch.browserProfileId ?? null,
      businessDate: batch.businessDate ?? null,
      sessionGeneration: batch.sessionGeneration ?? null,
      appVersion: batch.appVersion ?? null,
      dateStart: batch.dateStart,
      dateEnd: batch.dateEnd,
      storeName: batch.storeName ?? null,
      marketplaceCode: batch.marketplaceCode ?? 'US',
      status: batch.status,
      downloadDir: batch.downloadDir,
      manifestPath: batch.manifestPath ?? null,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt ?? null,
    };
    if (existing && (
      existing.dateStart !== next.dateStart
      || existing.dateEnd !== next.dateEnd
      || existing.createdAt !== next.createdAt
      || existing.marketplaceCode !== next.marketplaceCode
      || (existing.requestId !== null && existing.requestId !== next.requestId)
      || (existing.browserProfileId !== null
        && existing.browserProfileId !== next.browserProfileId)
      || (existing.businessDate !== null && existing.businessDate !== next.businessDate)
      || (existing.sessionGeneration !== null
        && existing.sessionGeneration !== next.sessionGeneration)
    )) {
      throw new Error(
        'LINGXING_BATCH_AUTHORITY_IMMUTABLE: 既有批次的日期窗口或 Store/Profile 核心身份不可改写。',
      );
    }
    if (existing?.hasCommittedImport === 1 && (
      existing.requestId !== next.requestId
      || existing.browserProfileId !== next.browserProfileId
      || existing.businessDate !== next.businessDate
      || existing.sessionGeneration !== next.sessionGeneration
      || existing.appVersion !== next.appVersion
      || existing.storeName !== next.storeName
      || existing.status !== next.status
      || existing.downloadDir !== next.downloadDir
      || existing.manifestPath !== next.manifestPath
      || existing.completedAt !== next.completedAt
    )) {
      throw new Error(
        'IMPORTED_BATCH_AUTHORITY_IMMUTABLE: 已提交导入证据的批次身份与来源元数据不可改写。',
      );
    }
    this.db.prepare(`
      INSERT INTO lingxing_report_batches (
        id, request_id, browser_profile_id, business_date, session_generation,
        app_version, date_start, date_end, store_name, marketplace_code,
        status, download_dir, manifest_path, created_at, completed_at, store_id
      ) VALUES (
        @id, @requestId, @browserProfileId, @businessDate, @sessionGeneration,
        @appVersion, @dateStart, @dateEnd, @storeName, @marketplaceCode,
        @status, @downloadDir, @manifestPath, @createdAt, @completedAt, @storeId
      )
      ON CONFLICT(id) DO UPDATE SET
        request_id = excluded.request_id,
        browser_profile_id = excluded.browser_profile_id,
        business_date = excluded.business_date,
        session_generation = excluded.session_generation,
        app_version = excluded.app_version,
        date_start = excluded.date_start,
        date_end = excluded.date_end,
        store_name = excluded.store_name,
        marketplace_code = excluded.marketplace_code,
        status = excluded.status,
        download_dir = excluded.download_dir,
        manifest_path = excluded.manifest_path,
        completed_at = excluded.completed_at
      WHERE lingxing_report_batches.store_id = excluded.store_id
    `).run({
      id: batch.id,
      ...next,
      storeId,
    });
  }

  private upsertLingxingFileRow(storeId: StoreId, file: LingxingReportFile): void {
    const existing = this.db.prepare(`
      SELECT store_id AS storeId FROM lingxing_report_files WHERE id = ?
    `).get(file.id) as { storeId?: string | null } | undefined;
    if (existing && existing.storeId !== storeId) {
      throw new Error(`领星文件 ${file.id} 已属于其他店铺或尚未完成归属确认。`);
    }
    this.assertBatchOwnership(storeId, file.batchId);
    this.db.prepare(`
      INSERT INTO lingxing_report_files (
        id, batch_id, report_type, display_name, status,
        max_auto_retries, auto_retry_count, file_path, file_size_bytes,
        error_message, attempt_errors_json, failure_screenshot_path,
        failure_dom_snapshot_path, failure_trace_path, trace_unavailable_reason,
        created_at, updated_at, store_id
      ) VALUES (
        @id, @batchId, @reportType, @displayName, @status,
        @maxAutoRetries, @autoRetryCount, @filePath, @fileSizeBytes,
        @errorMessage, @attemptErrorsJson, @failureScreenshotPath,
        @failureDomSnapshotPath, @failureTracePath, @traceUnavailableReason,
        @createdAt, @updatedAt, @storeId
      )
      ON CONFLICT(id) DO UPDATE SET
        report_type = excluded.report_type,
        display_name = excluded.display_name,
        status = excluded.status,
        max_auto_retries = excluded.max_auto_retries,
        auto_retry_count = excluded.auto_retry_count,
        file_path = excluded.file_path,
        file_size_bytes = excluded.file_size_bytes,
        error_message = excluded.error_message,
        attempt_errors_json = excluded.attempt_errors_json,
        failure_screenshot_path = excluded.failure_screenshot_path,
        failure_dom_snapshot_path = excluded.failure_dom_snapshot_path,
        failure_trace_path = excluded.failure_trace_path,
        trace_unavailable_reason = excluded.trace_unavailable_reason,
        updated_at = excluded.updated_at
      WHERE lingxing_report_files.store_id = excluded.store_id
        AND lingxing_report_files.batch_id = excluded.batch_id
    `).run({
      id: file.id,
      batchId: file.batchId,
      reportType: file.reportType,
      displayName: file.displayName,
      status: file.status,
      maxAutoRetries: file.maxAutoRetries ?? 2,
      autoRetryCount: file.autoRetryCount ?? 0,
      filePath: file.filePath ?? null,
      fileSizeBytes: file.fileSizeBytes ?? 0,
      errorMessage: file.errorMessage ?? null,
      attemptErrorsJson: JSON.stringify(file.attemptErrors ?? []),
      failureScreenshotPath: file.failureScreenshotPath ?? null,
      failureDomSnapshotPath: file.failureDomSnapshotPath ?? null,
      failureTracePath: file.failureTracePath ?? null,
      traceUnavailableReason: file.traceUnavailableReason ?? null,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      storeId,
    });
  }

  private upsertReportFileRow(
    storeId: StoreId,
    batchId: string,
    file: ReportImportFileInput,
    importedAt: string,
  ): number {
    validateImportFile(file);
    const existing = this.db.prepare(`
      SELECT id, store_id AS storeId FROM report_files
      WHERE batch_id = ? AND report_type = ? AND file_path = ?
    `).get(batchId, file.reportType, file.filePath) as { id: number; storeId?: string | null } | undefined;
    if (existing && existing.storeId !== storeId) {
      throw new Error('报表文件身份已属于其他店铺或尚未完成归属确认。');
    }
    if (existing) {
      this.db.prepare(`
        UPDATE report_files
        SET file_name = @fileName, file_size = @fileSizeBytes,
            status = 'imported', imported_rows = @importedRows,
            file_hash = @fileHash, import_error = NULL,
            last_imported_at = @importedAt, updated_at = @importedAt
        WHERE id = @id AND store_id = @storeId
      `).run({ ...file, id: existing.id, storeId, importedAt });
      return existing.id;
    }
    const result = this.db.prepare(`
      INSERT INTO report_files (
        store_id, batch_id, report_type, file_path, file_name, file_size,
        status, imported_rows, file_hash, import_error, last_imported_at,
        created_at, updated_at
      ) VALUES (
        @storeId, @batchId, @reportType, @filePath, @fileName, @fileSizeBytes,
        'imported', @importedRows, @fileHash, NULL, @importedAt,
        @importedAt, @importedAt
      )
    `).run({ ...file, storeId, batchId, importedAt });
    return Number(result.lastInsertRowid);
  }

  private insertMetricRow(
    storeId: StoreId,
    authority: StoreAuthority,
    batchId: string,
    metric: AdDailyMetrics,
  ): void {
    if (metric.batchId !== batchId) throw new Error('广告指标 batchId 与导入运行批次不一致。');
    if (
      normalizeIdentity(metric.storeName) !== normalizeIdentity(authority.displayName)
      || metric.marketplaceCode.trim().toUpperCase() !== authority.marketplace
      || String(metric.currency ?? 'USD').trim().toUpperCase() !== authority.currency
    ) throw new Error('指标店铺标识与 store_id 的权威记录不一致。');
    for (const [label, value] of [
      ['impressions', metric.impressions],
      ['clicks', metric.clicks],
      ['cost', metric.cost],
      ['orders', metric.orders],
      ['sales', metric.sales],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`广告指标 ${label} 无效。`);
    }
    const params = metricParams(storeId, metric);
    this.db.prepare(`
      DELETE FROM ad_daily_metrics
      WHERE store_id = @storeId
        AND COALESCE(batch_id, '') = COALESCE(@batchId, '')
        AND COALESCE(report_type, '') = COALESCE(@reportType, '')
        AND COALESCE(date, '') = COALESCE(@date, '')
        AND COALESCE(asin, '') = COALESCE(@asin, '')
        AND COALESCE(msku, '') = COALESCE(@msku, '')
        AND COALESCE(campaign_name, '') = COALESCE(@campaignName, '')
        AND COALESCE(ad_group_name, '') = COALESCE(@adGroupName, '')
        AND COALESCE(targeting, '') = COALESCE(@targeting, '')
        AND COALESCE(search_term, '') = COALESCE(@searchTerm, '')
        AND COALESCE(match_type, '') = COALESCE(@matchType, '')
        AND COALESCE(source_file, '') = COALESCE(@sourceFile, '')
        AND COALESCE(source_row, -1) = COALESCE(@sourceRow, -1)
    `).run(params);
    this.db.prepare(`
      INSERT INTO ad_daily_metrics (
        store_id, batch_id, report_type, portfolio_name,
        date, store_name, marketplace_code, asin, msku,
        campaign_name, ad_group_name, targeting, search_term, match_type,
        impressions, clicks, cost, orders, sales, currency,
        acos, cpc, cvr, source_file, source_row
      ) VALUES (
        @storeId, @batchId, @reportType, @portfolioName,
        @date, @storeName, @marketplaceCode, @asin, @msku,
        @campaignName, @adGroupName, @targeting, @searchTerm, @matchType,
        @impressions, @clicks, @cost, @orders, @sales, 'USD',
        @acos, @cpc, @cvr, @sourceFile, @sourceRow
      )
    `).run(params);
  }

  private assertBatchOwnership(
    storeId: StoreId,
    batchId: string,
  ): { dateStart: string; dateEnd: string } {
    const row = this.db.prepare(`
      SELECT store_id AS storeId, date_start AS dateStart, date_end AS dateEnd
      FROM lingxing_report_batches
      WHERE id = ?
    `).get(batchId) as {
      storeId?: string | null;
      dateStart?: string | null;
      dateEnd?: string | null;
    } | undefined;
    if (!row || row.storeId !== storeId) throw new Error(`报表批次 ${batchId} 不属于店铺 ${storeId}。`);
    const dateStart = canonicalIsoDate(row.dateStart, '批次 dateStart');
    const dateEnd = canonicalIsoDate(row.dateEnd, '批次 dateEnd');
    if (dateStart > dateEnd) throw new Error('报表批次日期窗口无效。');
    return { dateStart, dateEnd };
  }

  private findExistingRun(
    storeId: StoreId,
    runId: string,
    idempotencyKey: string,
  ): ReportImportRunRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM report_import_runs
      WHERE store_id = ? AND (run_id = ? OR idempotency_key = ?)
      ORDER BY CASE WHEN run_id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).get(storeId, runId, idempotencyKey, runId);
    return row ? mapRun(row, storeId) : undefined;
  }

  private resolveDuplicate(
    existing: ReportImportRunRecord,
    input: CommitReportImportInput,
    fingerprint: string,
  ): ReportImportCommitResult {
    if (existing.inputFingerprint !== fingerprint) {
      throw new Error('导入 runId 或幂等键已绑定不同输入，拒绝覆盖不可变历史。');
    }
    if (existing.idempotencyKey === input.idempotencyKey) {
      return { run: existing, deduplicated: true };
    }
    if (existing.runId === input.runId) {
      throw new Error('导入 runId 已绑定不同幂等键，拒绝覆盖不可变历史。');
    }
    return { run: existing, deduplicated: true };
  }
}

interface StoreAuthority {
  displayName: string;
  browserProfileId: string;
  businessTimezone: string;
  marketplace: string;
  currency: string;
  status: string;
}

const TERMINAL_COLLECTION_REPORT_STATES = new Set<LingxingCollectionReportCheckpoint['state']>([
  'downloaded',
  'failed',
  'create_unknown',
  'cancelled',
  'stale_authority',
]);

function cancelledCollectionJobSnapshot(
  job: LingxingCollectionJobSnapshot,
  options: {
    completedAt?: string;
    blockerCode: string;
    detail: string;
  },
): LingxingCollectionJobSnapshot {
  const latestKnownAt = [job.updatedAt, ...job.reports.map((checkpoint) => checkpoint.updatedAt)]
    .reduce((latest, candidate) => (
      Date.parse(candidate) > Date.parse(latest) ? candidate : latest
    ), job.updatedAt);
  const completedAt = nextCancellationTimestamp(latestKnownAt, options.completedAt);
  const checkpoints = new Map(job.reports.map((checkpoint) => [checkpoint.reportType, checkpoint]));
  const reports = job.request.reportTypes.map((reportType) => {
    const checkpoint = checkpoints.get(reportType);
    if (checkpoint && TERMINAL_COLLECTION_REPORT_STATES.has(checkpoint.state)) {
      return checkpoint;
    }
    return {
      reportType,
      state: 'cancelled' as const,
      attemptIndex: checkpoint?.attemptIndex ?? 0,
      autoRetryCount: checkpoint?.autoRetryCount ?? 0,
      ...(checkpoint?.createdReportIdentity
        ? { createdReportIdentity: checkpoint.createdReportIdentity }
        : {}),
      ...(checkpoint?.fileSizeBytes !== undefined
        ? { fileSizeBytes: checkpoint.fileSizeBytes }
        : {}),
      errorCode: options.blockerCode,
      detail: options.detail,
      updatedAt: completedAt,
    };
  });
  const cancelled: LingxingCollectionJobSnapshot = {
    ...job,
    state: 'cancelled',
    reports,
    updatedAt: completedAt,
    completedAt,
    blockerCode: options.blockerCode,
    detail: options.detail,
    importState: 'not_applicable',
  };
  delete cancelled.importAttemptedAt;
  delete cancelled.importCompletedAt;
  delete cancelled.importError;
  return cancelled;
}

function nextCancellationTimestamp(previous: string, requested?: string): string {
  const previousMs = Date.parse(previous);
  const requestedMs = requested === undefined ? Date.now() : Date.parse(requested);
  if (!Number.isFinite(requestedMs)) {
    throw new Error('取消采集 completedAt 无效。');
  }
  const nextMs = Number.isFinite(previousMs)
    ? Math.max(requestedMs, previousMs + 1)
    : requestedMs;
  return new Date(nextMs).toISOString();
}

function normalizeCollectionJobSnapshot(
  snapshot: LingxingCollectionJobSnapshot,
): LingxingCollectionJobSnapshot {
  const context = normalizeStoreContextEnvelope(snapshot.request.storeContext);
  const reports = snapshot.reports.map((checkpoint) => ({
    reportType: checkpoint.reportType,
    state: checkpoint.state,
    attemptIndex: checkpoint.attemptIndex,
    autoRetryCount: checkpoint.autoRetryCount,
    ...(checkpoint.createdReportIdentity ? {
      createdReportIdentity: {
        provider: checkpoint.createdReportIdentity.provider,
        reportType: checkpoint.createdReportIdentity.reportType,
        externalReportName: checkpoint.createdReportIdentity.externalReportName,
        ...(checkpoint.createdReportIdentity.externalReportId
          ? { externalReportId: checkpoint.createdReportIdentity.externalReportId }
          : {}),
        dateStart: checkpoint.createdReportIdentity.dateStart,
        dateEnd: checkpoint.createdReportIdentity.dateEnd,
        createdAt: checkpoint.createdReportIdentity.createdAt,
      },
    } : {}),
    ...(checkpoint.fileSizeBytes !== undefined ? { fileSizeBytes: checkpoint.fileSizeBytes } : {}),
    ...(checkpoint.errorCode ? { errorCode: pathFreeText(checkpoint.errorCode) } : {}),
    ...(checkpoint.detail ? { detail: pathFreeText(checkpoint.detail) } : {}),
    updatedAt: checkpoint.updatedAt,
  })) as LingxingCollectionReportCheckpoint[];
  return {
    jobId: requiredText(snapshot.jobId, 'jobId'),
    request: {
      requestId: requiredText(snapshot.request.requestId, 'requestId'),
      storeContext: context,
      dateStart: requiredText(snapshot.request.dateStart, 'dateStart'),
      dateEnd: requiredText(snapshot.request.dateEnd, 'dateEnd'),
      mode: snapshot.request.mode,
      reportTypes: [...snapshot.request.reportTypes],
    },
    ...(snapshot.lineage ? {
      lineage: {
        lineageId: requiredText(snapshot.lineage.lineageId, 'lineageId'),
        rootJobId: requiredText(snapshot.lineage.rootJobId, 'rootJobId'),
        ...(snapshot.lineage.parentJobId
          ? { parentJobId: requiredText(snapshot.lineage.parentJobId, 'parentJobId') }
          : {}),
        expectedReportTypes: [...snapshot.lineage.expectedReportTypes],
        purpose: snapshot.lineage.purpose,
      },
    } : {}),
    state: snapshot.state,
    reports,
    createdAt: requiredText(snapshot.createdAt, 'createdAt'),
    updatedAt: requiredText(snapshot.updatedAt, 'updatedAt'),
    ...(snapshot.completedAt ? { completedAt: snapshot.completedAt } : {}),
    ...(snapshot.blockerCode ? { blockerCode: pathFreeText(snapshot.blockerCode) } : {}),
    ...(snapshot.detail ? { detail: pathFreeText(snapshot.detail) } : {}),
    ...(snapshot.importState ? { importState: snapshot.importState } : {}),
    ...(snapshot.importAttemptedAt
      ? { importAttemptedAt: requiredText(snapshot.importAttemptedAt, 'importAttemptedAt') }
      : {}),
    ...(snapshot.importCompletedAt
      ? { importCompletedAt: requiredText(snapshot.importCompletedAt, 'importCompletedAt') }
      : {}),
    ...(snapshot.importError ? { importError: pathFreeText(snapshot.importError) } : {}),
  };
}

function validateCollectionJobSnapshot(
  storeId: StoreId,
  authority: StoreAuthority,
  snapshot: LingxingCollectionJobSnapshot,
): void {
  if (!/^[A-Za-z0-9._-]{1,180}$/.test(snapshot.jobId)) throw new Error('采集 jobId 无效。');
  if (snapshot.lineage) {
    const safeId = (value: string) => /^[A-Za-z0-9._-]{1,180}$/.test(value);
    const expectedTypes = new Set(snapshot.lineage.expectedReportTypes);
    if (
      !safeId(snapshot.lineage.lineageId)
      || !safeId(snapshot.lineage.rootJobId)
      || (snapshot.lineage.parentJobId !== undefined && !safeId(snapshot.lineage.parentJobId))
      || expectedTypes.size !== COMPLETE_LINGXING_REPORT_TYPES.size
      || [...COMPLETE_LINGXING_REPORT_TYPES].some((reportType) => !expectedTypes.has(reportType))
      || snapshot.request.reportTypes.some((reportType) => !expectedTypes.has(reportType))
      || !['production_full', 'resume', 'retry'].includes(snapshot.lineage.purpose)
    ) {
      throw new Error('采集 lineage 无效或不包含完整八类报表授权范围。');
    }
  }
  const context = snapshot.request.storeContext;
  if (
    String(context.storeId) !== String(storeId)
    || String(context.browserProfileId) !== authority.browserProfileId
    || context.marketplace !== authority.marketplace
    || context.currency !== authority.currency
    || context.businessTimezone !== authority.businessTimezone
  ) throw new Error('采集快照 StoreContext 与店铺权威记录不一致。');
  if (!Number.isSafeInteger(Number(context.sessionGeneration)) || Number(context.sessionGeneration) < 0) {
    throw new Error('采集快照 sessionGeneration 无效。');
  }
  if (
    snapshot.importState
    && !LINGXING_COLLECTION_IMPORT_STATES.includes(snapshot.importState)
  ) {
    throw new Error('采集快照 importState 无效。');
  }
  if (
    snapshot.importState
    && snapshot.importState !== 'not_applicable'
    && snapshot.state !== 'completed'
    && snapshot.state !== 'completed_with_errors'
  ) {
    throw new Error('只有下载终态任务可以进入指标导入生命周期。');
  }
  if (snapshot.importState === 'succeeded' && !snapshot.importCompletedAt) {
    throw new Error('导入成功快照必须包含 importCompletedAt。');
  }
  if (snapshot.importState === 'failed' && !snapshot.importError) {
    throw new Error('导入失败快照必须包含 importError。');
  }
  const requestedTypes = new Set(snapshot.request.reportTypes);
  if (requestedTypes.size !== snapshot.request.reportTypes.length) {
    throw new Error('采集请求包含重复报表类型。');
  }
  const checkpointTypes = new Set<string>();
  for (const checkpoint of snapshot.reports) {
    if (!requestedTypes.has(checkpoint.reportType) || checkpointTypes.has(checkpoint.reportType)) {
      throw new Error('采集 checkpoint 重复或超出请求报表范围。');
    }
    checkpointTypes.add(checkpoint.reportType);
    if (!Number.isSafeInteger(checkpoint.attemptIndex) || checkpoint.attemptIndex < 0) {
      throw new Error('采集 checkpoint attemptIndex 无效。');
    }
    if (!Number.isSafeInteger(checkpoint.autoRetryCount) || checkpoint.autoRetryCount < 0) {
      throw new Error('采集 checkpoint autoRetryCount 无效。');
    }
    if (checkpoint.fileSizeBytes !== undefined
      && (!Number.isSafeInteger(checkpoint.fileSizeBytes) || checkpoint.fileSizeBytes < 0)) {
      throw new Error('采集 checkpoint fileSizeBytes 无效。');
    }
    if (checkpoint.createdReportIdentity
      && checkpoint.createdReportIdentity.reportType !== checkpoint.reportType) {
      throw new Error('采集 checkpoint 的已创建报表身份与报表类型不一致。');
    }
  }
}

function validateCollectionLineage(
  database: Database,
  storeId: StoreId,
  snapshot: LingxingCollectionJobSnapshot,
): void {
  const lineage = snapshot.lineage;
  if (!lineage) return;
  const isProductionRoot = lineage.purpose === 'production_full';
  if (isProductionRoot) {
    if (
      lineage.lineageId !== snapshot.jobId
      || lineage.rootJobId !== snapshot.jobId
      || lineage.parentJobId !== undefined
      || snapshot.request.requestId.startsWith('canary:')
      || snapshot.request.reportTypes.length !== COMPLETE_LINGXING_REPORT_TYPES.size
    ) {
      throw new Error('生产采集 root lineage 与完整八类任务身份不一致。');
    }
    return;
  }
  if (!lineage.parentJobId || lineage.parentJobId === snapshot.jobId) {
    throw new Error('采集 continuation lineage 缺少有效父任务。');
  }
  const parentRow = database.prepare(`
    SELECT snapshot_json AS snapshotJson
    FROM lingxing_collection_jobs
    WHERE store_id = ? AND job_id = ?
  `).get(storeId, lineage.parentJobId) as { snapshotJson: string } | undefined;
  if (!parentRow) throw new Error('采集 continuation lineage 的父任务不存在于当前店铺。');
  const parent = parseRequiredJson<LingxingCollectionJobSnapshot>(
    parentRow.snapshotJson,
    '采集 lineage 父任务快照',
  );
  const parentIsFull = parent.request.reportTypes.length === COMPLETE_LINGXING_REPORT_TYPES.size
    && [...COMPLETE_LINGXING_REPORT_TYPES].every((reportType) => parent.request.reportTypes.includes(reportType));
  const parentLineageId = parent.lineage?.lineageId ?? (parentIsFull ? parent.jobId : undefined);
  const sameCanaryClass = parent.request.requestId.startsWith('canary:')
    === snapshot.request.requestId.startsWith('canary:');
  if (
    !parentLineageId
    || lineage.lineageId !== parentLineageId
    || lineage.rootJobId !== parentLineageId
    || parent.request.dateStart !== snapshot.request.dateStart
    || parent.request.dateEnd !== snapshot.request.dateEnd
    || parent.request.storeContext.storeId !== snapshot.request.storeContext.storeId
    || parent.request.storeContext.marketplace !== snapshot.request.storeContext.marketplace
    || parent.request.storeContext.currency !== snapshot.request.storeContext.currency
    || !sameCanaryClass
    || JSON.stringify(parent.lineage?.expectedReportTypes ?? parent.request.reportTypes)
      !== JSON.stringify(lineage.expectedReportTypes)
  ) {
    throw new Error('采集 continuation lineage 与父任务的店铺、日期窗或授权范围不一致。');
  }
}

const TERMINAL_COLLECTION_JOB_STATES = new Set<LingxingCollectionJobSnapshot['state']>([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'stale_authority',
]);

function validateCollectionTerminalIdentity(
  storeId: StoreId,
  authority: StoreAuthority,
  job: LingxingCollectionJobSnapshot,
  batch: LingxingReportBatch,
  files: readonly LingxingReportFile[],
): void {
  validateCollectionJobSnapshot(storeId, authority, job);
  if (!TERMINAL_COLLECTION_JOB_STATES.has(job.state)) {
    throw new Error(`采集 job ${job.jobId} 尚未进入终态，拒绝 final commit。`);
  }
  if (!job.completedAt || !batch.completedAt) {
    throw new Error('终态采集 job 与批次都必须包含 completedAt。');
  }
  if (job.jobId !== batch.id) throw new Error('终态采集 jobId 与 batch.id 不一致。');
  if (!batch.requestId || batch.requestId !== job.request.requestId) {
    throw new Error('终态采集 requestId 与批次身份不一致。');
  }
  const context = job.request.storeContext;
  if (
    String(batch.storeId ?? '') !== String(context.storeId)
    || String(batch.browserProfileId ?? '') !== String(context.browserProfileId)
    || String(batch.businessDate ?? '') !== String(context.businessDate)
    || Number(batch.sessionGeneration) !== Number(context.sessionGeneration)
    || batch.marketplaceCode !== context.marketplace
    || batch.dateStart !== job.request.dateStart
    || batch.dateEnd !== job.request.dateEnd
  ) throw new Error('终态采集 StoreContext、日期范围或批次身份不一致。');

  const expectedBatchStatus = job.state === 'completed'
    ? 'completed'
    : job.state === 'completed_with_errors'
      ? 'completed_with_errors'
      : 'failed';
  if (batch.status !== expectedBatchStatus) {
    throw new Error(`终态 job ${job.state} 与 batch.status ${batch.status} 不一致。`);
  }

  const requestedTypes = new Set(job.request.reportTypes);
  const checkpointTypes = new Set(job.reports.map((checkpoint) => checkpoint.reportType));
  if (checkpointTypes.size !== job.reports.length
    || checkpointTypes.size !== requestedTypes.size
    || [...requestedTypes].some((reportType) => !checkpointTypes.has(reportType))) {
    throw new Error('终态采集 checkpoint 未完整覆盖请求报表类型。');
  }
  const fileTypes = new Set(files.map((file) => file.reportType));
  if (fileTypes.size !== files.length || [...fileTypes].some((reportType) => !requestedTypes.has(reportType))) {
    throw new Error('终态采集文件重复或超出请求报表范围。');
  }
  if (job.state === 'completed' && (
    fileTypes.size !== requestedTypes.size
    || [...requestedTypes].some((reportType) => !fileTypes.has(reportType))
    || files.some((file) => file.status !== 'downloaded')
    || job.reports.some((checkpoint) => checkpoint.state !== 'downloaded')
  )) {
    throw new Error('completed 终态必须包含全部已下载报表与 checkpoint。');
  }
}

function mapCollectionCheckpoint(row: any): LingxingCollectionReportCheckpoint {
  return {
    reportType: row.report_type,
    state: row.state,
    attemptIndex: row.attempt_index,
    autoRetryCount: row.auto_retry_count,
    ...(row.created_report_identity_json ? {
      createdReportIdentity: parseRequiredJson(row.created_report_identity_json, '已创建报表身份'),
    } : {}),
    ...(row.file_size_bytes !== null ? { fileSizeBytes: row.file_size_bytes } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.detail ? { detail: row.detail } : {}),
    updatedAt: row.updated_at,
  };
}

function assertCollectionAuthorityJobRow(
  storeId: StoreId,
  requestId: string,
  row: LingxingCollectionAuthorityProof['jobRow'],
  snapshot: LingxingCollectionJobSnapshot,
  checkpointCount: number,
  checkpoints: readonly LingxingCollectionReportCheckpoint[],
): void {
  const context = normalizeStoreContextEnvelope(snapshot.request.storeContext);
  const reportTypes = parseRequiredJson<unknown>(
    row.reportTypesJson,
    '采集 job SQL report_types_json',
  );
  const sortedSnapshotCheckpoints = [...snapshot.reports]
    .sort((left, right) => String(left.reportType).localeCompare(String(right.reportType)));
  const sortedRows = [...checkpoints]
    .sort((left, right) => String(left.reportType).localeCompare(String(right.reportType)));
  if (row.storeId !== storeId
    || context.storeId !== storeId
    || row.jobId !== snapshot.jobId
    || row.requestId !== requestId
    || row.requestId !== snapshot.request.requestId
    || row.browserProfileId !== context.browserProfileId
    || row.marketplace !== context.marketplace
    || row.currency !== context.currency
    || row.businessTimezone !== context.businessTimezone
    || row.businessDate !== context.businessDate
    || row.sessionGeneration !== context.sessionGeneration
    || row.dateStart !== snapshot.request.dateStart
    || row.dateEnd !== snapshot.request.dateEnd
    || row.mode !== snapshot.request.mode
    || stableJson(reportTypes) !== stableJson(snapshot.request.reportTypes)
    || row.state !== snapshot.state
    || row.createdAt !== snapshot.createdAt
    || row.updatedAt !== snapshot.updatedAt
    || row.completedAt !== (snapshot.completedAt ?? null)
    || row.blockerCode !== (snapshot.blockerCode ?? null)
    || row.detail !== (snapshot.detail ?? null)
    || checkpointCount !== checkpoints.length
    || checkpointCount !== snapshot.reports.length
    || checkpointCount > COMPLETE_LINGXING_REPORT_TYPES.size
    || stableJson(sortedRows) !== stableJson(sortedSnapshotCheckpoints)
    || (snapshot.lineage?.purpose === 'production_full' && (
      snapshot.lineage.lineageId !== row.jobId
      || snapshot.lineage.rootJobId !== row.jobId
      || snapshot.lineage.parentJobId !== undefined
    ))) {
    throw new Error('采集 authority proof 的 SQL row/snapshot/lineage/checkpoint 身份不一致。');
  }
}

function assertCollectionAuthorityProofTimestamps(
  proof: LingxingCollectionAuthorityProof,
): void {
  const required: unknown[] = [
    proof.job.createdAt,
    proof.job.updatedAt,
    proof.jobRow.createdAt,
    proof.jobRow.updatedAt,
    ...proof.job.reports.flatMap((checkpoint) => [
      checkpoint.updatedAt,
      ...(checkpoint.createdReportIdentity
        ? [checkpoint.createdReportIdentity.createdAt]
        : []),
    ]),
    ...(proof.batch ? [proof.batch.createdAt] : []),
    ...proof.lingxingFiles.flatMap((file) => [file.createdAt, file.updatedAt]),
    ...proof.importRuns.flatMap((run) => [run.startedAt, run.completedAt, run.createdAt]),
    ...proof.importFileSnapshots.map((snapshot) => snapshot.capturedAt),
    ...proof.metricEvidence.map((evidence) => evidence.createdAt),
  ];
  const optional: unknown[] = [
    proof.job.completedAt,
    proof.job.importAttemptedAt,
    proof.job.importCompletedAt,
    proof.jobRow.completedAt,
    proof.batch?.completedAt,
    ...proof.importedReportFiles.map((file) => file.lastImportedAt),
  ];
  if (required.some((value) => !isCanonicalUtcInstant(value))
    || optional.some((value) => value !== undefined
      && value !== null
      && !isCanonicalUtcInstant(value))) {
    throw new Error('采集 authority proof 包含非规范 ISO-8601 UTC 时间戳。');
  }

  assertAuthorityTimestampOrder('job.createdAt <= job.updatedAt', proof.job.createdAt, proof.job.updatedAt);
  if (proof.job.completedAt) {
    assertAuthorityTimestampOrder(
      'job.createdAt <= job.completedAt',
      proof.job.createdAt,
      proof.job.completedAt,
    );
    assertAuthorityTimestampOrder(
      'job.completedAt <= job.updatedAt',
      proof.job.completedAt,
      proof.job.updatedAt,
    );
  }
  for (const checkpoint of proof.job.reports) {
    assertAuthorityTimestampOrder(
      `job.createdAt <= checkpoint.${checkpoint.reportType}.updatedAt`,
      proof.job.createdAt,
      checkpoint.updatedAt,
    );
    assertAuthorityTimestampOrder(
      `checkpoint.${checkpoint.reportType}.updatedAt <= job.updatedAt`,
      checkpoint.updatedAt,
      proof.job.updatedAt,
    );
    if (checkpoint.createdReportIdentity) {
      assertAuthorityTimestampOrder(
        `job.createdAt <= checkpoint.${checkpoint.reportType}.createdReportIdentity.createdAt`,
        proof.job.createdAt,
        checkpoint.createdReportIdentity.createdAt,
      );
      assertAuthorityTimestampOrder(
        `checkpoint.${checkpoint.reportType}.createdReportIdentity.createdAt <= checkpoint.updatedAt`,
        checkpoint.createdReportIdentity.createdAt,
        checkpoint.updatedAt,
      );
    }
  }
  if (proof.batch) {
    assertAuthorityTimestampOrder(
      'job.createdAt <= batch.createdAt',
      proof.job.createdAt,
      proof.batch.createdAt,
    );
    assertAuthorityTimestampOrder(
      'batch.createdAt <= job.updatedAt',
      proof.batch.createdAt,
      proof.job.updatedAt,
    );
    if (proof.batch.completedAt) {
      assertAuthorityTimestampOrder(
        'batch.createdAt <= batch.completedAt',
        proof.batch.createdAt,
        proof.batch.completedAt,
      );
      assertAuthorityTimestampOrder(
        'batch.completedAt <= job.updatedAt',
        proof.batch.completedAt,
        proof.job.updatedAt,
      );
    }
  }
  for (const file of proof.lingxingFiles) {
    assertAuthorityTimestampOrder(
      `lingxingFile.${file.id}.createdAt <= updatedAt`,
      file.createdAt,
      file.updatedAt,
    );
    assertAuthorityTimestampOrder(
      `job.createdAt <= lingxingFile.${file.id}.createdAt`,
      proof.job.createdAt,
      file.createdAt,
    );
    assertAuthorityTimestampOrder(
      `lingxingFile.${file.id}.updatedAt <= job.updatedAt`,
      file.updatedAt,
      proof.job.updatedAt,
    );
    if (proof.batch?.completedAt) {
      assertAuthorityTimestampOrder(
        `lingxingFile.${file.id}.updatedAt <= batch.completedAt`,
        file.updatedAt,
        proof.batch.completedAt,
      );
    }
  }
  if (proof.job.importAttemptedAt) {
    if (proof.job.completedAt) {
      assertAuthorityTimestampOrder(
        'job.completedAt <= job.importAttemptedAt',
        proof.job.completedAt,
        proof.job.importAttemptedAt,
      );
    }
    assertAuthorityTimestampOrder(
      'job.importAttemptedAt <= job.updatedAt',
      proof.job.importAttemptedAt,
      proof.job.updatedAt,
    );
  }
  if (proof.job.importCompletedAt) {
    if (proof.job.importAttemptedAt) {
      assertAuthorityTimestampOrder(
        'job.importAttemptedAt <= job.importCompletedAt',
        proof.job.importAttemptedAt,
        proof.job.importCompletedAt,
      );
    }
    assertAuthorityTimestampOrder(
      'job.importCompletedAt <= job.updatedAt',
      proof.job.importCompletedAt,
      proof.job.updatedAt,
    );
  }
  const runsById = new Map(proof.importRuns.map((run) => [run.runId, run]));
  for (const run of proof.importRuns) {
    assertAuthorityTimestampOrder(
      `importRun.${run.runId}.startedAt <= completedAt`,
      run.startedAt,
      run.completedAt,
    );
    assertAuthorityTimestampOrder(
      `importRun.${run.runId}.completedAt <= createdAt`,
      run.completedAt,
      run.createdAt,
    );
    if (proof.job.completedAt) {
      assertAuthorityTimestampOrder(
        `job.completedAt <= importRun.${run.runId}.startedAt`,
        proof.job.completedAt,
        run.startedAt,
      );
    }
    if (proof.job.importAttemptedAt) {
      assertAuthorityTimestampOrder(
        `job.importAttemptedAt <= importRun.${run.runId}.startedAt`,
        proof.job.importAttemptedAt,
        run.startedAt,
      );
    }
    if (proof.job.importCompletedAt) {
      assertAuthorityTimestampOrder(
        `importRun.${run.runId}.completedAt <= job.importCompletedAt`,
        run.completedAt,
        proof.job.importCompletedAt,
      );
    }
  }
  for (const snapshot of proof.importFileSnapshots) {
    const run = runsById.get(snapshot.runId);
    if (!run) continue;
    assertAuthorityTimestampOrder(
      `importRun.${run.runId}.startedAt <= snapshot.${snapshot.snapshotId}.capturedAt`,
      run.startedAt,
      snapshot.capturedAt,
    );
    assertAuthorityTimestampOrder(
      `snapshot.${snapshot.snapshotId}.capturedAt <= importRun.${run.runId}.completedAt`,
      snapshot.capturedAt,
      run.completedAt,
    );
  }
  const uniqueRun = proof.importRunCount === 1 && proof.importRuns.length === 1
    ? proof.importRuns[0]
    : undefined;
  for (const file of proof.importedReportFiles) {
    if (!file.lastImportedAt) continue;
    if (!uniqueRun) {
      throw new Error(
        `采集 authority proof 时间顺序无效：importedReportFile.${file.id} 缺少唯一 import run。`,
      );
    }
    assertAuthorityTimestampOrder(
      `importRun.${uniqueRun.runId}.startedAt <= importedReportFile.${file.id}.lastImportedAt`,
      uniqueRun.startedAt,
      file.lastImportedAt,
    );
    assertAuthorityTimestampOrder(
      `importedReportFile.${file.id}.lastImportedAt <= importRun.${uniqueRun.runId}.completedAt`,
      file.lastImportedAt,
      uniqueRun.completedAt,
    );
    if (proof.job.completedAt) {
      assertAuthorityTimestampOrder(
        `job.completedAt <= importedReportFile.${file.id}.lastImportedAt`,
        proof.job.completedAt,
        file.lastImportedAt,
      );
    }
    if (proof.job.importCompletedAt) {
      assertAuthorityTimestampOrder(
        `importedReportFile.${file.id}.lastImportedAt <= job.importCompletedAt`,
        file.lastImportedAt,
        proof.job.importCompletedAt,
      );
    }
  }
}

function assertAuthorityTimestampOrder(label: string, earlier: string, later: string): void {
  if (Date.parse(earlier) > Date.parse(later)) {
    throw new Error(`采集 authority proof 时间顺序无效：${label}。`);
  }
}

function normalizeCollectionSemanticScope(
  input: LingxingCollectionSemanticScope,
): LingxingCollectionSemanticScope {
  if (!input || typeof input !== 'object') {
    throw new Error('采集 semantic scope 无效。');
  }
  const storeId = requiredText(input.storeId, 'semantic scope.storeId') as StoreId;
  const browserProfileId = requiredText(
    input.browserProfileId,
    'semantic scope.browserProfileId',
  );
  const businessDate = canonicalIsoDate(input.businessDate, 'semantic scope.businessDate');
  const dateStart = canonicalIsoDate(input.dateStart, 'semantic scope.dateStart');
  const dateEnd = canonicalIsoDate(input.dateEnd, 'semantic scope.dateEnd');
  if (dateStart > dateEnd) {
    throw new Error('采集 semantic scope date window 无效。');
  }
  if (input.mode !== 'create-and-download') {
    throw new Error('采集 semantic scope 仅接受 create-and-download。');
  }
  if (!Array.isArray(input.reportTypes)
    || input.reportTypes.length !== COMPLETE_LINGXING_REPORT_TYPES.size
    || new Set(input.reportTypes).size !== COMPLETE_LINGXING_REPORT_TYPES.size
    || input.reportTypes.some((reportType) => (
      !COMPLETE_LINGXING_REPORT_TYPES.has(reportType)
    ))) {
    throw new Error('采集 semantic scope 必须是严格且不重复的 8/8 领星广告报表集合。');
  }
  return {
    storeId,
    browserProfileId,
    businessDate,
    dateStart,
    dateEnd,
    mode: 'create-and-download',
    reportTypes: [...COMPLETE_LINGXING_REPORT_TYPES],
  };
}

function assertCollectionAuthorityProofSemanticScope(
  scope: LingxingCollectionSemanticScope,
  proof: LingxingCollectionAuthorityProof,
): void {
  const context = normalizeStoreContextEnvelope(proof.job.request.storeContext);
  const rowReportTypes = parseRequiredJson<unknown>(
    proof.jobRow.reportTypesJson,
    '采集 job SQL report_types_json',
  );
  if (proof.jobRow.storeId !== scope.storeId
    || context.storeId !== scope.storeId
    || proof.jobRow.browserProfileId !== scope.browserProfileId
    || context.browserProfileId !== scope.browserProfileId
    || proof.jobRow.marketplace !== 'US'
    || context.marketplace !== 'US'
    || proof.jobRow.currency !== 'USD'
    || context.currency !== 'USD'
    || proof.jobRow.businessTimezone !== 'America/Los_Angeles'
    || context.businessTimezone !== 'America/Los_Angeles'
    || proof.jobRow.businessDate !== scope.businessDate
    || context.businessDate !== scope.businessDate
    || proof.jobRow.dateStart !== scope.dateStart
    || proof.job.request.dateStart !== scope.dateStart
    || proof.jobRow.dateEnd !== scope.dateEnd
    || proof.job.request.dateEnd !== scope.dateEnd
    || proof.jobRow.mode !== scope.mode
    || proof.job.request.mode !== scope.mode
    || !sameCompleteLingxingReportTypeSet(rowReportTypes)
    || !sameCompleteLingxingReportTypeSet(proof.job.request.reportTypes)) {
    throw new Error('采集 authority proof 与 exact semantic scope 身份不一致。');
  }
}

function sameCompleteLingxingReportTypeSet(value: unknown): value is LingxingReportType[] {
  return Array.isArray(value)
    && value.length === COMPLETE_LINGXING_REPORT_TYPES.size
    && new Set(value).size === COMPLETE_LINGXING_REPORT_TYPES.size
    && value.every((reportType) => (
      typeof reportType === 'string'
      && COMPLETE_LINGXING_REPORT_TYPES.has(reportType as LingxingReportType)
    ));
}

function canonicalIsoDate(value: unknown, label: string): string {
  const text = requiredText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)
    || !Number.isFinite(Date.parse(`${text}T00:00:00.000Z`))
    || new Date(`${text}T00:00:00.000Z`).toISOString().slice(0, 10) !== text) {
    throw new Error(`${label} 必须是规范 YYYY-MM-DD。`);
  }
  return text;
}

function isCanonicalUtcInstant(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(new Date(value).getTime())
    && new Date(value).toISOString() === value;
}

function canonicalUtcInstant(value: unknown, label: string): string {
  if (!isCanonicalUtcInstant(value)) {
    throw new Error(`${label} 必须是规范 ISO-8601 UTC 时间戳。`);
  }
  return value;
}

function canonicalMonotonicAfter(
  requestedValue: unknown,
  floorValue: unknown,
  label: string,
): string {
  const requested = canonicalUtcInstant(requestedValue, label);
  const floor = canonicalUtcInstant(floorValue, `${label} floor`);
  return new Date(Math.max(Date.parse(requested), Date.parse(floor) + 1)).toISOString();
}

function latestCanonicalInstant(values: readonly unknown[], label: string): string {
  if (values.length === 0) throw new Error(`${label} 至少需要一个时间戳。`);
  return values.map((value, index) => canonicalUtcInstant(value, `${label}[${index}]`))
    .reduce((latest, value) => (
      Date.parse(value) > Date.parse(latest) ? value : latest
    ));
}

function requiredSha256(value: unknown, label: string): string {
  const text = requiredText(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label} 必须是 SHA-256。`);
  return text;
}

function parseRequiredJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} JSON 已损坏。`);
  }
}

function normalizeCommitInput(input: CommitReportImportInput): CommitReportImportInput {
  const runId = requiredText(input.runId, 'runId');
  const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey');
  const batchId = requiredText(input.batchId, 'batchId');
  const files = input.files.map((file) => ({
    ...file,
    lingxingFileId: file.lingxingFileId ? requiredText(file.lingxingFileId, 'lingxingFileId') : undefined,
    reportType: requiredText(file.reportType, 'reportType'),
    filePath: requiredText(file.filePath, 'filePath'),
    fileName: requiredText(file.fileName, 'fileName'),
    fileHash: requiredText(file.fileHash, 'fileHash').toLowerCase(),
  }));
  const reconciliations = input.reconciliations.map((reconciliation) => ({
    ...reconciliation,
    dateStart: canonicalIsoDate(reconciliation.dateStart, 'reconciliation.dateStart'),
    dateEnd: canonicalIsoDate(reconciliation.dateEnd, 'reconciliation.dateEnd'),
    metricDate: canonicalIsoDate(reconciliation.metricDate, 'reconciliation.metricDate'),
    reportType: requiredText(reconciliation.reportType, 'reportType'),
    tolerance: reconciliation.tolerance ?? 0.01,
  }));
  const startedAt = input.startedAt === undefined
    ? undefined
    : canonicalUtcInstant(input.startedAt, 'startedAt');
  const completedAt = input.completedAt === undefined
    ? undefined
    : canonicalUtcInstant(input.completedAt, 'completedAt');
  if (startedAt !== undefined
    && completedAt !== undefined
    && Date.parse(startedAt) > Date.parse(completedAt)) {
    throw new Error('IMPORT_RUN_TIMELINE_INVALID: completedAt 不能早于 startedAt。');
  }
  return {
    ...input,
    runId,
    idempotencyKey,
    batchId,
    files,
    metrics: input.metrics.map(normalizeMetricForImport),
    reconciliations,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
  };
}

function assertExactReportImportCoverage(input: CommitReportImportInput): void {
  const filesByType = new Map<string, ReportImportFileInput>();
  for (const file of input.files) {
    if (filesByType.has(file.reportType)) {
      throw new Error(
        `IMPORT_REPORT_TYPE_NOT_UNIQUE: report file ${file.reportType} 在同一运行中重复。`,
      );
    }
    filesByType.set(file.reportType, file);
  }

  const reconciliationsByType = new Map<string, ReportImportReconciliationInput>();
  for (const reconciliation of input.reconciliations) {
    if (!Number.isSafeInteger(reconciliation.expectedRows) || reconciliation.expectedRows < 0) {
      throw new Error(
        `IMPORT_RECONCILIATION_MISMATCH: ${reconciliation.reportType} expectedRows 必须是非负安全整数。`,
      );
    }
    if (reconciliationsByType.has(reconciliation.reportType)) {
      throw new Error(
        `IMPORT_REPORT_TYPE_NOT_UNIQUE: reconciliation ${reconciliation.reportType} 在同一运行中重复。`,
      );
    }
    reconciliationsByType.set(reconciliation.reportType, reconciliation);
  }

  if (filesByType.size !== reconciliationsByType.size
    || [...filesByType.keys()].some((reportType) => !reconciliationsByType.has(reportType))) {
    throw new Error(
      'IMPORT_REPORT_COVERAGE_MISMATCH: 每种报表必须唯一对应一个文件和一条 reconciliation。',
    );
  }

  const metricRowsByType = new Map<string, number>();
  for (const metric of input.metrics) {
    const reportType = requiredText(metric.reportType, 'metric.reportType');
    if (!reconciliationsByType.has(reportType)) {
      throw new Error(
        `IMPORT_METRIC_REPORT_TYPE_UNCOVERED: 指标 reportType ${reportType} 没有唯一 reconciliation。`,
      );
    }
    metricRowsByType.set(reportType, (metricRowsByType.get(reportType) ?? 0) + 1);
  }

  let coveredMetricRows = 0;
  for (const [reportType, reconciliation] of reconciliationsByType) {
    const file = filesByType.get(reportType)!;
    const actualRows = metricRowsByType.get(reportType) ?? 0;
    if (actualRows !== file.importedRows || actualRows !== reconciliation.expectedRows) {
      throw new Error(
        `IMPORT_RECONCILIATION_MISMATCH IMPORT_REPORT_ROW_COUNT_MISMATCH ${reportType}: `
        + `metrics ${actualRows}, file ${file.importedRows}, reconciliation ${reconciliation.expectedRows}。`,
      );
    }
    coveredMetricRows += actualRows;
  }
  if (!Number.isSafeInteger(coveredMetricRows) || coveredMetricRows !== input.metrics.length) {
    throw new Error(
      `IMPORT_METRIC_ROW_TOTAL_MISMATCH: metrics ${input.metrics.length}, covered ${coveredMetricRows}。`,
    );
  }
}

function normalizeInPlaceResumeReports(
  proof: LingxingCollectionAuthorityProof,
): LingxingCollectionReportCheckpoint[] {
  if (
    proof.job.state !== 'failed'
    || proof.job.request.mode !== 'create-and-download'
    || !sameCompleteLingxingReportTypeSet(proof.job.request.reportTypes)
    || proof.checkpointCount !== COMPLETE_LINGXING_REPORT_TYPES.size
    || proof.job.reports.length !== COMPLETE_LINGXING_REPORT_TYPES.size
  ) {
    throw new Error('原地续跑只接受原任务失败的完整八报表 create-and-download 快照。');
  }
  if (
    !proof.batch
    || proof.batch.id !== proof.job.jobId
    || proof.batch.requestId !== proof.job.request.requestId
    || proof.batch.storeId !== proof.job.request.storeContext.storeId
    || proof.batch.browserProfileId !== proof.job.request.storeContext.browserProfileId
    || proof.batch.businessDate !== proof.job.request.storeContext.businessDate
    || proof.batch.sessionGeneration !== proof.job.request.storeContext.sessionGeneration
    || proof.batch.dateStart !== proof.job.request.dateStart
    || proof.batch.dateEnd !== proof.job.request.dateEnd
  ) {
    throw new Error('原地续跑 job/request/batch durable identity 不一致。');
  }
  const filesByType = new Map<LingxingReportType, StoreScopedLingxingReportFile[]>();
  if (
    proof.lingxingFileCount !== proof.lingxingFiles.length
    || proof.lingxingFileCount > COMPLETE_LINGXING_REPORT_TYPES.size
  ) {
    throw new Error('原地续跑 durable file rows 被截断或超过完整八报表范围。');
  }
  for (const file of proof.lingxingFiles) {
    if (
      file.storeId !== proof.job.request.storeContext.storeId
      || file.batchId !== proof.job.jobId
      || !COMPLETE_LINGXING_REPORT_TYPES.has(file.reportType)
    ) {
      throw new Error('原地续跑 durable file 不属于 exact store/batch/report scope。');
    }
    const current = filesByType.get(file.reportType) ?? [];
    current.push(file);
    filesByType.set(file.reportType, current);
    if (current.length > 1) {
      throw new Error(`原地续跑 reportType ${file.reportType} 存在重复 durable file。`);
    }
  }
  return proof.job.reports.map((checkpoint) => {
    const identity = checkpoint.createdReportIdentity;
    if (identity) assertResumeCreatedIdentity(identity, checkpoint, proof.job);
    if (
      checkpoint.state === 'creating'
      || checkpoint.state === 'create_unknown'
      || checkpoint.state === 'cancelled'
      || checkpoint.state === 'stale_authority'
    ) {
      throw new Error(`checkpoint ${checkpoint.reportType}/${checkpoint.state} 禁止自动原地续跑。`);
    }
    if (checkpoint.state === 'downloaded') {
      const files = filesByType.get(checkpoint.reportType) ?? [];
      if (!identity
        || files.length !== 1
        || files[0].status !== 'downloaded'
        || !files[0].filePath
        || !Number.isSafeInteger(files[0].fileSizeBytes)
        || files[0].fileSizeBytes! <= 0
        || checkpoint.fileSizeBytes !== files[0].fileSizeBytes) {
        throw new Error(`downloaded checkpoint ${checkpoint.reportType} 缺少唯一 durable file proof。`);
      }
      return cloneCollectionCheckpoint(checkpoint);
    }
    if (checkpoint.state === 'queued') {
      if (identity) throw new Error('queued checkpoint 不能携带 created identity。');
      return cloneCollectionCheckpoint(checkpoint);
    }
    if (checkpoint.state === 'created' || checkpoint.state === 'ready') {
      if (!identity) throw new Error(`${checkpoint.state} checkpoint 必须携带 created identity。`);
      return cloneCollectionCheckpoint(checkpoint);
    }
    if (checkpoint.state === 'waiting_ready' && !identity) {
      throw new Error('waiting_ready checkpoint 缺少 created identity，拒绝猜测创建结果。');
    }
    if ((checkpoint.state === 'downloading' || checkpoint.state === 'verifying') && !identity) {
      throw new Error(`${checkpoint.state} checkpoint 缺少 created identity。`);
    }
    const normalizedState = checkpoint.state === 'downloading' || checkpoint.state === 'verifying'
      ? 'ready'
      : identity
        ? 'created'
        : 'queued';
    return {
      ...cloneCollectionCheckpoint(checkpoint),
      state: normalizedState,
      fileSizeBytes: undefined,
      errorCode: undefined,
      detail: '由 Main durable recovery 归一化，尚未执行任何浏览器动作。',
    };
  });
}

function isFinalSucceededResumeProof(proof: LingxingCollectionAuthorityProof): boolean {
  return proof.job.state === 'completed'
    && proof.job.importState === 'succeeded'
    && proof.job.reports.length === COMPLETE_LINGXING_REPORT_TYPES.size
    && proof.job.reports.every((checkpoint) => checkpoint.state === 'downloaded')
    && proof.lingxingFileCount === COMPLETE_LINGXING_REPORT_TYPES.size
    && proof.lingxingFiles.length === COMPLETE_LINGXING_REPORT_TYPES.size
    && proof.batch?.status === 'completed'
    && proof.importRunCount === 1
    && proof.metricEvidenceCount === 1;
}

function normalizeInterruptedResumeReports(
  reports: readonly LingxingCollectionReportCheckpoint[],
  updatedAt: string,
): LingxingCollectionReportCheckpoint[] {
  return reports.map((checkpoint) => {
    if (checkpoint.state === 'downloaded'
      || checkpoint.state === 'queued'
      || checkpoint.state === 'created'
      || checkpoint.state === 'ready'
      || checkpoint.state === 'create_unknown'
      || checkpoint.state === 'cancelled'
      || checkpoint.state === 'stale_authority') {
      return cloneCollectionCheckpoint(checkpoint);
    }
    if (checkpoint.state === 'creating') {
      return {
        ...cloneCollectionCheckpoint(checkpoint),
        state: 'create_unknown',
        errorCode: 'LINGXING_CREATE_OUTCOME_UNKNOWN_AFTER_RESTART',
        detail: '应用重启时创建调用尚无确定结果，必须人工核对。',
        updatedAt,
      };
    }
    const identity = checkpoint.createdReportIdentity;
    const state = checkpoint.state === 'downloading' || checkpoint.state === 'verifying'
      ? (identity ? 'ready' : 'create_unknown')
      : identity
        ? 'created'
        : 'queued';
    return {
      ...cloneCollectionCheckpoint(checkpoint),
      state,
      fileSizeBytes: state === 'queued' || state === 'created' || state === 'ready'
        ? undefined
        : checkpoint.fileSizeBytes,
      errorCode: state === 'create_unknown'
        ? 'LINGXING_CREATE_OUTCOME_UNKNOWN_AFTER_RESTART'
        : undefined,
      detail: state === 'create_unknown'
        ? '应用重启后无法证明安全恢复点，必须人工核对。'
        : '应用重启已恢复到最近可证明的安全状态，等待人工重新发起。',
      updatedAt,
    };
  });
}

function assertResumeCreatedIdentity(
  identity: NonNullable<LingxingCollectionReportCheckpoint['createdReportIdentity']>,
  checkpoint: LingxingCollectionReportCheckpoint,
  job: LingxingCollectionJobSnapshot,
): void {
  if (
    identity.provider !== 'lingxing'
    || identity.reportType !== checkpoint.reportType
    || identity.dateStart !== job.request.dateStart
    || identity.dateEnd !== job.request.dateEnd
    || !requiredText(identity.externalReportName, 'created identity externalReportName')
    || !isCanonicalUtcInstant(identity.createdAt)
  ) {
    throw new Error(`checkpoint ${checkpoint.reportType} created identity 与原请求不一致。`);
  }
}

function cloneCollectionCheckpoint(
  checkpoint: LingxingCollectionReportCheckpoint,
): LingxingCollectionReportCheckpoint {
  return {
    ...checkpoint,
    ...(checkpoint.createdReportIdentity
      ? { createdReportIdentity: { ...checkpoint.createdReportIdentity } }
      : {}),
  };
}

function assertExecutionContextCanResume(
  durableValue: StoreContextEnvelope,
  executionValue: StoreContextEnvelope,
): void {
  const durable = normalizeStoreContextEnvelope(durableValue);
  const execution = normalizeStoreContextEnvelope(executionValue);
  const stableDurable = {
    ...durable,
    sessionGeneration: 0,
  };
  const stableExecution = {
    ...execution,
    sessionGeneration: 0,
  };
  if (stableJson(stableDurable) !== stableJson(stableExecution)
    || execution.sessionGeneration < durable.sessionGeneration) {
    throw new Error('当前执行上下文与 durable store axes 不一致或 generation 回退。');
  }
}

function safeResumeIdentifier(value: unknown, label: string): string {
  const normalized = requiredText(value, label);
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(normalized)) {
    throw new Error(`${label} 必须是安全标识符。`);
  }
  return normalized;
}

function sha256Text(value: unknown, label: string): string {
  const normalized = requiredText(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} 必须是 sha256 hex。`);
  }
  return normalized;
}

function hashOpaqueClaimToken(value: unknown): string {
  return createHash('sha256')
    .update(requiredText(value, 'claimToken'))
    .digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateImportFile(file: ReportImportFileInput): void {
  if (!Number.isSafeInteger(file.fileSizeBytes) || file.fileSizeBytes < 0) {
    throw new Error('报表文件大小必须是非负安全整数。');
  }
  if (!Number.isSafeInteger(file.importedRows) || file.importedRows < 0) {
    throw new Error('报表导入行数必须是非负安全整数。');
  }
}

function normalizeMetricForImport(metric: AdDailyMetrics): AdDailyMetrics {
  return {
    batchId: metric.batchId,
    reportType: metric.reportType,
    portfolioName: metric.portfolioName,
    date: canonicalIsoDate(metric.date, 'metric.date'),
    storeName: metric.storeName,
    marketplaceCode: metric.marketplaceCode,
    asin: metric.asin,
    msku: metric.msku,
    campaignName: metric.campaignName,
    adGroupName: metric.adGroupName,
    targeting: metric.targeting,
    searchTerm: metric.searchTerm,
    matchType: metric.matchType,
    impressions: metric.impressions,
    clicks: metric.clicks,
    cost: metric.cost,
    orders: metric.orders,
    sales: metric.sales,
    currency: metric.currency ?? 'USD',
    acos: metric.acos,
    cpc: metric.cpc,
    cvr: metric.cvr,
    sourceFile: metric.sourceFile,
    sourceRow: metric.sourceRow,
  };
}

function importFingerprint(input: CommitReportImportInput): string {
  const payload = {
    batchId: input.batchId,
    files: [...input.files].sort(compareByStableJson),
    metrics: [...input.metrics].sort(compareByStableJson),
    reconciliations: [...input.reconciliations].sort(compareByStableJson),
  };
  return createHash('sha256').update(stableJson(payload)).digest('hex');
}

function compareByStableJson(left: unknown, right: unknown): number {
  return stableJson(left).localeCompare(stableJson(right));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function metricParams(storeId: StoreId, metric: AdDailyMetrics): Record<string, unknown> {
  return {
    storeId,
    batchId: metric.batchId ?? null,
    reportType: metric.reportType ?? null,
    portfolioName: metric.portfolioName ?? null,
    date: metric.date,
    storeName: metric.storeName,
    marketplaceCode: metric.marketplaceCode,
    asin: metric.asin,
    msku: metric.msku,
    campaignName: metric.campaignName,
    adGroupName: metric.adGroupName,
    targeting: metric.targeting,
    searchTerm: metric.searchTerm,
    matchType: metric.matchType,
    impressions: metric.impressions,
    clicks: metric.clicks,
    cost: metric.cost,
    orders: metric.orders,
    sales: metric.sales,
    acos: metric.acos,
    cpc: metric.cpc,
    cvr: metric.cvr,
    sourceFile: metric.sourceFile,
    sourceRow: metric.sourceRow ?? null,
  };
}

function metricIdentity(metric: AdDailyMetrics): string {
  return stableJson([
    metric.batchId ?? '',
    metric.reportType ?? '',
    metric.date,
    metric.asin,
    metric.msku,
    metric.campaignName,
    metric.adGroupName,
    metric.targeting,
    metric.searchTerm,
    metric.matchType,
    metric.sourceFile,
    metric.sourceRow ?? -1,
  ]);
}

function mapBatch(row: any, storeId: StoreId): StoreScopedLingxingReportBatch {
  return {
    id: row.id,
    storeId,
    requestId: row.request_id ?? undefined,
    browserProfileId: row.browser_profile_id ?? undefined,
    businessDate: row.business_date ?? undefined,
    sessionGeneration: row.session_generation ?? undefined,
    appVersion: row.app_version ?? undefined,
    dateStart: row.date_start,
    dateEnd: row.date_end,
    storeName: row.store_name ?? undefined,
    marketplaceCode: row.marketplace_code ?? undefined,
    status: row.status,
    downloadDir: row.download_dir,
    manifestPath: row.manifest_path ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function mapLingxingFile(row: any, storeId: StoreId): StoreScopedLingxingReportFile {
  return {
    id: row.id,
    storeId,
    batchId: row.batch_id,
    reportType: row.report_type,
    displayName: row.display_name,
    status: row.status,
    maxAutoRetries: row.max_auto_retries,
    autoRetryCount: row.auto_retry_count,
    filePath: row.file_path ?? undefined,
    fileSizeBytes: row.file_size_bytes,
    errorMessage: row.error_message ?? undefined,
    attemptErrors: parseJsonArray(row.attempt_errors_json),
    failureScreenshotPath: row.failure_screenshot_path ?? undefined,
    failureDomSnapshotPath: row.failure_dom_snapshot_path ?? undefined,
    failureTracePath: row.failure_trace_path ?? undefined,
    traceUnavailableReason: row.trace_unavailable_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: any, storeId: StoreId): ReportImportRunRecord {
  return {
    storeId,
    runId: row.run_id,
    idempotencyKey: row.idempotency_key,
    inputFingerprint: row.input_fingerprint,
    batchId: row.batch_id,
    status: row.status,
    sourceFileCount: row.source_file_count,
    metricRowCount: row.metric_row_count,
    reconciliationCount: row.reconciliation_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function mapFileSnapshot(row: any, storeId: StoreId): ReportImportFileSnapshotRecord {
  return {
    storeId,
    snapshotId: row.snapshot_id,
    runId: row.run_id,
    batchId: row.batch_id,
    lingxingFileId: row.lingxing_file_id ?? undefined,
    reportFileId: row.report_file_id ?? undefined,
    reportType: row.report_type,
    filePath: row.file_path,
    fileName: row.file_name,
    fileSizeBytes: row.file_size_bytes,
    fileHash: row.file_hash,
    importedRows: row.imported_rows,
    capturedAt: row.captured_at,
  };
}

function mapImportedReportFile(row: any, storeId: StoreId): StoreScopedImportedReportFile {
  return {
    id: row.id,
    storeId,
    batchId: row.batch_id,
    reportType: row.report_type,
    filePath: row.file_path,
    fileName: row.file_name,
    fileSizeBytes: row.file_size,
    status: row.status,
    importedRows: row.imported_rows,
    fileHash: row.file_hash ?? undefined,
    importError: row.import_error ?? undefined,
    lastImportedAt: row.last_imported_at ?? undefined,
  };
}

function mapReconciliation(row: any, storeId: StoreId): ReportImportReconciliationRecord {
  return {
    storeId,
    reconciliationId: row.reconciliation_id,
    runId: row.run_id,
    batchId: row.batch_id,
    dateStart: canonicalIsoDate(row.reconciliation_date_start, 'reconciliation.dateStart'),
    dateEnd: canonicalIsoDate(row.reconciliation_date_end, 'reconciliation.dateEnd'),
    metricDate: row.metric_date,
    reportType: row.report_type,
    currency: 'USD',
    expectedRows: row.expected_rows,
    actualRows: row.actual_rows,
    expectedCost: row.expected_cost_1e4 / 10_000,
    actualCost: row.actual_cost_1e4 / 10_000,
    absoluteCostDelta: row.absolute_cost_delta_1e4 / 10_000,
    tolerance: row.tolerance_1e4 / 10_000,
    withinTolerance: row.within_tolerance === 1,
    status: row.status,
    reconciledAt: row.reconciled_at,
  };
}

function amountTo1e4(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} amount must be a non-negative finite number.`);
  const scaled = Math.round(value * 10_000);
  if (!Number.isSafeInteger(scaled)) throw new Error(`${label} amount is outside the supported range.`);
  return scaled;
}

function stableId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
  return `${prefix}_${digest}`;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 不能为空。`);
  return value.trim();
}

function pathFreeText(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\s"'<>]*/g, '[local-path-redacted]')
    .replace(/\\\\[^\s"'<>]+/g, '[local-path-redacted]')
    .replace(/\/(?:Users|home|tmp|var|opt|mnt)\/[^\s"'<>]*/g, '[local-path-redacted]');
}

function normalizeIdentity(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function boundedPositiveInteger(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.trunc(value), max));
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
