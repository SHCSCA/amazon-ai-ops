import type { LingxingCollectionJobSnapshot, LingxingReportType } from '@amazon-ai-ops/shared-types';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';

const FULL_REPORT_TYPES = new Set<string>(
  LINGXING_AD_REPORTS.map((report) => report.type),
);

export function isExactLingxingFull8ReportSet(
  reportTypes: readonly LingxingReportType[],
): boolean {
  return reportTypes.length === FULL_REPORT_TYPES.size
    && new Set(reportTypes).size === FULL_REPORT_TYPES.size
    && reportTypes.every((reportType) => FULL_REPORT_TYPES.has(reportType));
}

/**
 * Legacy resume may still recover an already-complete job in place, but it
 * must never create a second durable task for any historical full-eight job,
 * regardless of its old mode or request-id prefix.
 */
export function assertLegacyLingxingResumeMayCreateJob(
  job: Pick<LingxingCollectionJobSnapshot, 'request'>,
): void {
  if (isExactLingxingFull8ReportSet(job.request.reportTypes)) {
    throw new Error(
      'FULL8_REMEDIATION_MAIN_RUNTIME_REQUIRED: 完整八报表恢复必须回到 MainRuntime 的原语义任务，旧恢复入口不得生成新的 requestId/job。',
    );
  }
}
