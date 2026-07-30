import { createHash } from 'crypto';
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
} from '@amazon-ai-ops/shared-types';
import {
  LINGXING_COLLECTION_IMPORT_STATES,
  normalizeStoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

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
}

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
        FROM lingxing_collection_jobs
        WHERE store_id = ? AND state IN ('queued', 'running')
        ORDER BY updated_at ASC, job_id ASC
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
      };
      assertCollectionAuthorityProofTimestamps(proof);
      return proof;
    });
    return read.deferred();
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
      this.assertBatchOwnership(storeId, normalizedInput.batchId);

      const now = new Date().toISOString();
      const startedAt = normalizedInput.startedAt ?? now;
      const completedAt = normalizedInput.completedAt ?? now;
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
        createdAt: now,
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
        const identity = metricIdentity(metric);
        if (metricIdentities.has(identity)) {
          throw new Error('同一导入运行包含重复的广告指标数据粒度，拒绝覆盖后伪造行数。');
        }
        metricIdentities.add(identity);
        this.insertMetricRow(storeId, authority, normalizedInput.batchId, metric);
      }

      normalizedInput.reconciliations.forEach((reconciliation, index) => {
        const actualMetrics = normalizedInput.metrics.filter((metric) => (
          metric.date === reconciliation.metricDate
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
            `IMPORT_RECONCILIATION_MISMATCH ${reconciliation.metricDate} ${reconciliation.reportType}: `
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
      SELECT * FROM report_import_reconciliations
      WHERE store_id = ? AND run_id = ?
      ORDER BY metric_date, report_type, reconciliation_id
    `).all(storeId, runId).map((row) => mapReconciliation(row, storeId));
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
      SELECT store_id AS storeId FROM lingxing_report_batches WHERE id = ?
    `).get(batch.id) as { storeId?: string | null } | undefined;
    if (existing && existing.storeId !== storeId) {
      throw new Error(`领星批次 ${batch.id} 已属于其他店铺或尚未完成归属确认。`);
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

  private assertBatchOwnership(storeId: StoreId, batchId: string): void {
    const row = this.db.prepare(`
      SELECT store_id AS storeId FROM lingxing_report_batches WHERE id = ?
    `).get(batchId) as { storeId?: string | null } | undefined;
    if (!row || row.storeId !== storeId) throw new Error(`报表批次 ${batchId} 不属于店铺 ${storeId}。`);
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
}

function isCanonicalUtcInstant(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(new Date(value).getTime())
    && new Date(value).toISOString() === value;
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
    metricDate: requiredText(reconciliation.metricDate, 'metricDate'),
    reportType: requiredText(reconciliation.reportType, 'reportType'),
    tolerance: reconciliation.tolerance ?? 0.01,
  }));
  return {
    ...input,
    runId,
    idempotencyKey,
    batchId,
    files,
    metrics: input.metrics.map(normalizeMetricForImport),
    reconciliations,
  };
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
