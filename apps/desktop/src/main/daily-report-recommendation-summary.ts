import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';

export interface DailyReportRecommendationSummaryInput {
  total: number;
  statusCounts: Partial<Record<ActionRecommendation['status'], number>>;
}

export interface DailyReportRecommendationSummary {
  total: number;
  auto: number;
  pending: number;
  executed: number;
}

export interface DailyReportRecommendationCountReader {
  countByDate(date: string): number;
  countByDateAndStatus(date: string, status: ActionRecommendation['status']): number;
}

export function buildDailyReportRecommendationSummary(
  input: DailyReportRecommendationSummaryInput,
): DailyReportRecommendationSummary {
  return {
    total: input.total,
    auto: 0,
    pending: input.statusCounts.pending || 0,
    executed: input.statusCounts.executed || 0,
  };
}

export function readDailyReportRecommendationSummary(
  reader: DailyReportRecommendationCountReader | null | undefined,
  date: string,
): DailyReportRecommendationSummary {
  if (!reader) {
    return buildDailyReportRecommendationSummary({ total: 0, statusCounts: {} });
  }
  return buildDailyReportRecommendationSummary({
    total: reader.countByDate(date),
    statusCounts: {
      pending: reader.countByDateAndStatus(date, 'pending'),
      executed: reader.countByDateAndStatus(date, 'executed'),
    },
  });
}
