import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildDailyReportRecommendationSummary,
  readDailyReportRecommendationSummary,
} from './daily-report-recommendation-summary';

describe('daily report recommendation summary', () => {
  it('does not report approved recommendations as executed or automatically executed', () => {
    expect(buildDailyReportRecommendationSummary({
      total: 7,
      statusCounts: {
        pending: 2,
        approved: 5,
      },
    })).toEqual({
      total: 7,
      auto: 0,
      pending: 2,
      executed: 0,
    });
  });

  it('reports only recommendations with the executed status as executed', () => {
    expect(buildDailyReportRecommendationSummary({
      total: 9,
      statusCounts: {
        pending: 1,
        approved: 5,
        executed: 3,
      },
    })).toEqual({
      total: 9,
      auto: 0,
      pending: 1,
      executed: 3,
    });
  });

  it('reads pending and executed counts without treating approved rows as executed', () => {
    const counts = {
      pending: 1,
      approved: 5,
      executed: 3,
    } as const;

    expect(readDailyReportRecommendationSummary({
      countByDate: () => 9,
      countByDateAndStatus: (_date, status) => counts[status as keyof typeof counts] || 0,
    }, '2026-07-14')).toEqual({
      total: 9,
      auto: 0,
      pending: 1,
      executed: 3,
    });
  });

  it('wires daily report generation through the tested status reader', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const dailyReportBlock = source.slice(
      source.indexOf('async function runDailyReportGeneration'),
      source.indexOf('// IPC Handlers'),
    );

    expect(dailyReportBlock).toContain(
      'recommendationsSummary: readDailyReportRecommendationSummary(state.recommendationRepo, today)',
    );
    expect(dailyReportBlock).not.toContain("countByDateAndStatus(today, 'approved')");
  });
});
