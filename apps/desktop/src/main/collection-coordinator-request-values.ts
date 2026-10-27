import * as fs from 'fs';
import {
  LINGXING_AD_REPORTS,
  type RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  LingxingCollectionProgressEvent,
  LingxingCollectionRequestDto,
  LingxingReportType,
} from '@amazon-ai-ops/shared-types';
import {
  missionControlContextKey,
  normalizeStoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type {
  StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import {
  assertPathContained,
} from '@amazon-ai-ops/browser-worker';
import {
  SAFE_REQUEST_ID,
  REPORT_TYPES,
  ISO_DATE,
} from "./collection-coordinator-constants";
import {
  type StartLingxingCollectionInput,
} from "./collection-coordinator-contracts";

export function normalizeCollectionRequest(
  input: StartLingxingCollectionInput,
): LingxingCollectionRequestDto {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Lingxing collection request must be an object');
  }
  const requestId = String(input.requestId || '').trim();
  if (!SAFE_REQUEST_ID.test(requestId)) {
    throw new TypeError('Lingxing collection requestId is invalid');
  }
  if (input.mode !== 'create-and-download' && input.mode !== 'download-existing') {
    throw new TypeError('Lingxing collection mode is invalid');
  }
  const dateStart = normalizeIsoDate(input.dateStart, 'dateStart');
  const dateEnd = normalizeIsoDate(input.dateEnd, 'dateEnd');
  if (dateStart > dateEnd) {
    throw new TypeError('Lingxing collection date range must be ascending');
  }
  const storeContext = normalizeStoreContextEnvelope(input.storeContext);
  const reportTypes = input.reportTypes === undefined
    ? LINGXING_AD_REPORTS.map((report) => report.type)
    : [...input.reportTypes];
  if (
    reportTypes.length < 1
    || new Set(reportTypes).size !== reportTypes.length
    || reportTypes.some((reportType) => !REPORT_TYPES.has(reportType))
  ) {
    throw new TypeError('Lingxing collection reportTypes are invalid');
  }
  return {
    requestId,
    storeContext,
    dateStart,
    dateEnd,
    mode: input.mode,
    reportTypes,
  };
}

export function normalizeIsoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new TypeError(`Lingxing collection ${label} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`Lingxing collection ${label} is invalid`);
  }
  return value;
}

export function assertProgressBelongsToRequest(
  event: LingxingCollectionProgressEvent,
  request: LingxingCollectionRequestDto,
): void {
  if (
    event.job.request.requestId !== request.requestId
    || event.job.request.mode !== request.mode
    || event.job.request.dateStart !== request.dateStart
    || event.job.request.dateEnd !== request.dateEnd
    || missionControlContextKey(event.job.request.storeContext)
      !== missionControlContextKey(request.storeContext)
    || !sameReportTypeSet(event.job.request.reportTypes, request.reportTypes)
    || !sameReportTypeSet(
      event.job.reports.map((checkpoint) => checkpoint.reportType),
      request.reportTypes,
    )
  ) {
    throw new Error('LINGXING_COLLECTION_PROGRESS_SCOPE_MISMATCH');
  }
}

export function assertResultBelongsToRequest(
  result: RunBatchResult,
  request: LingxingCollectionRequestDto,
  capsule: StoreCapsulePaths,
): void {
  assertProgressBelongsToRequest({
    eventId: `${result.job.jobId}:final`,
    emittedAt: result.job.updatedAt,
    job: result.job,
  }, request);
  if (
    result.job.jobId !== result.batch.id
    || result.batch.requestId !== request.requestId
    || result.batch.storeId !== request.storeContext.storeId
    || result.batch.browserProfileId !== request.storeContext.browserProfileId
    || result.batch.businessDate !== request.storeContext.businessDate
    || result.batch.sessionGeneration !== request.storeContext.sessionGeneration
    || result.batch.marketplaceCode !== request.storeContext.marketplace
    || result.batch.dateStart !== request.dateStart
    || result.batch.dateEnd !== request.dateEnd
  ) {
    throw new Error('LINGXING_COLLECTION_RESULT_SCOPE_MISMATCH');
  }
  assertPathContained(capsule.downloadsDir, result.batch.downloadDir);
  if (result.batch.manifestPath) {
    assertPathContained(result.batch.downloadDir, result.batch.manifestPath);
  }
  if (
    (result.job.state === 'completed' || result.job.state === 'completed_with_errors')
    && (
      !result.batch.manifestPath
      || !fs.existsSync(result.batch.manifestPath)
      || !fs.statSync(result.batch.manifestPath).isFile()
    )
  ) {
    throw new Error('LINGXING_COLLECTION_RESULT_MANIFEST_MISSING');
  }
  if (
    (result.job.state === 'completed' || result.job.state === 'completed_with_errors')
    && !sameReportTypeSet(
      result.files.map((file) => file.reportType),
      request.reportTypes,
    )
  ) {
    throw new Error('LINGXING_COLLECTION_RESULT_FILE_SET_INCOMPLETE');
  }
  const seenFileIds = new Set<string>();
  for (const file of result.files) {
    if (
      file.batchId !== result.batch.id
      || !request.reportTypes.includes(file.reportType)
      || seenFileIds.has(file.id)
    ) {
      throw new Error('LINGXING_COLLECTION_RESULT_FILE_SCOPE_MISMATCH');
    }
    seenFileIds.add(file.id);
    if (file.filePath) assertPathContained(result.batch.downloadDir, file.filePath);
    if (
      file.status === 'downloaded'
      && (
        !file.filePath
        || !fs.existsSync(file.filePath)
        || !fs.statSync(file.filePath).isFile()
      )
    ) {
      throw new Error('LINGXING_COLLECTION_RESULT_DOWNLOADED_FILE_MISSING');
    }
  }
}

export function sameReportTypeSet(
  left: readonly LingxingReportType[],
  right: readonly LingxingReportType[],
): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((reportType) => right.includes(reportType));
}
