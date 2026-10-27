import {
  createHash,
} from 'node:crypto';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionJobSnapshot,
} from '@amazon-ai-ops/shared-types';
import type {
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

export function rendererSafeJob(job: LingxingCollectionJobSnapshot): LingxingCollectionJobSnapshot {
  const context = normalizeStoreContextEnvelope(job.request.storeContext);
  return {
    jobId: job.jobId,
    request: {
      requestId: job.request.requestId,
      storeContext: {
        storeId: context.storeId,
        browserProfileId: context.browserProfileId,
        marketplace: context.marketplace,
        currency: context.currency,
        businessTimezone: context.businessTimezone,
        businessDate: context.businessDate,
        sessionGeneration: context.sessionGeneration,
      },
      dateStart: job.request.dateStart,
      dateEnd: job.request.dateEnd,
      mode: job.request.mode,
      reportTypes: [...job.request.reportTypes],
    },
    ...(job.lineage ? {
      lineage: {
        lineageId: job.lineage.lineageId,
        rootJobId: job.lineage.rootJobId,
        ...(job.lineage.parentJobId ? { parentJobId: job.lineage.parentJobId } : {}),
        expectedReportTypes: [...job.lineage.expectedReportTypes],
        purpose: job.lineage.purpose,
      },
    } : {}),
    state: job.state,
    reports: job.reports.map((report) => ({
      reportType: report.reportType,
      state: report.state,
      attemptIndex: report.attemptIndex,
      autoRetryCount: report.autoRetryCount,
      ...(report.createdReportIdentity ? {
        createdReportIdentity: {
          provider: report.createdReportIdentity.provider,
          reportType: report.createdReportIdentity.reportType,
          externalReportName: report.createdReportIdentity.externalReportName,
          ...(report.createdReportIdentity.externalReportId === undefined
            ? {}
            : { externalReportId: report.createdReportIdentity.externalReportId }),
          dateStart: report.createdReportIdentity.dateStart,
          dateEnd: report.createdReportIdentity.dateEnd,
          createdAt: report.createdReportIdentity.createdAt,
        },
      } : {}),
      ...(report.fileSizeBytes === undefined ? {} : { fileSizeBytes: report.fileSizeBytes }),
      ...(report.errorCode === undefined ? {} : { errorCode: report.errorCode }),
      updatedAt: report.updatedAt,
    })),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }),
    ...(job.blockerCode === undefined ? {} : { blockerCode: job.blockerCode }),
    ...(job.importState === undefined ? {} : { importState: job.importState }),
    ...(job.importAttemptedAt === undefined ? {} : { importAttemptedAt: job.importAttemptedAt }),
    ...(job.importCompletedAt === undefined ? {} : { importCompletedAt: job.importCompletedAt }),
  };
}

export function detailForState(
  state: 'waiting' | 'due' | 'claimed' | 'succeeded' | 'failed',
): string {
  switch (state) {
    case 'waiting': return '等待当前店铺配置的采集时间。';
    case 'due': return '已到当前店铺配置的采集时间。';
    case 'claimed': return '当前店铺采集任务已持久认领，正在等待采集或导入终结。';
    case 'succeeded': return '当前店铺本业务日采集与导入已完成。';
    case 'failed': return '当前店铺本业务日采集链已失败关闭，不会自动重试。';
  }
}

export function deriveWindow(
  businessDate: string,
  lookbackDays: number,
): { dateStart: string; dateEnd: string } {
  const dateEnd = shiftIsoDate(businessDate, -1);
  return {
    dateStart: shiftIsoDate(dateEnd, -(lookbackDays - 1)),
    dateEnd,
  };
}

export function shiftIsoDate(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('store collection business date is invalid');
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function semanticFingerprint(input: {
  context: StoreContextEnvelope;
  lookbackDays: number;
  dateStart: string;
  dateEnd: string;
}): string {
  return createHash('sha256').update(JSON.stringify({
    collectionContractVersion: 'lingxing-us-ads-full8-v1',
    storeId: input.context.storeId,
    browserProfileId: input.context.browserProfileId,
    businessDate: input.context.businessDate,
    lookbackDays: input.lookbackDays,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
  })).digest('hex');
}

export function localBusinessClock(now: Date, timeZone: string): {
  businessDate: string;
  localTime: string;
} {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('store collection clock is invalid');
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): string => (
    parts.find((part) => part.type === type)?.value ?? ''
  );
  return {
    businessDate: `${read('year')}-${read('month')}-${read('day')}`,
    localTime: `${read('hour')}:${read('minute')}`,
  };
}
