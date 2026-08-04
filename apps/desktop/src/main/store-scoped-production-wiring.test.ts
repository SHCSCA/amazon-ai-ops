import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const recommendationMetricSourceAuthority = readFileSync(
  new URL('./recommendation-metric-source-authority.ts', import.meta.url),
  'utf8',
);
const writableAdTargetResolution = readFileSync(
  new URL('./writable-ad-target-resolution.ts', import.meta.url),
  'utf8',
);

const deprecatedProductionCalls = [
  ['product upsert', /state\.productRepo(?:\?|!)?\.upsert\s*\(/g],
  ['product ASIN read', /state\.productRepo(?:\?|!)?\.findByAsin\s*\(/g],
  ['product list read', /state\.productRepo(?:\?|!)?\.findAll\s*\(/g],
  ['product cost list read', /state\.productRepo(?:\?|!)?\.findAllWithCosts\s*\(/g],
  ['product cost write', /state\.productRepo(?:\?|!)?\.updateCost\s*\(/g],
  ['product cost read', /state\.productRepo(?:\?|!)?\.getCost\s*\(/g],
  ['product target write', /state\.productRepo(?:\?|!)?\.updateTargetAcosMany\s*\(/g],
  ['product insert', /state\.productRepo(?:\?|!)?\.insert\s*\(/g],
  ['operation event create', /state\.operationEventRepo(?:\?|!)?\.create\s*\(/g],
  ['operation event id read', /state\.operationEventRepo(?:\?|!)?\.getById\s*\(/g],
  ['operation event scope read', /state\.operationEventRepo(?:\?|!)?\.findByScope\s*\(/g],
  ['operation event update', /state\.operationEventRepo(?:\?|!)?\.update\s*\(/g],
  ['operation event archive', /state\.operationEventRepo(?:\?|!)?\.archive\s*\(/g],
  ['report file upsert', /state\.reportFileRepo(?:\?|!)?\.upsert\s*\(/g],
  ['report file business read', /state\.reportFileRepo(?:\?|!)?\.findBusinessReportFiles\s*\(/g],
  ['report file read', /state\.reportFileRepo(?:\?|!)?\.find\s*\(/g],
  ['ad metric batch delete', /state\.adMetricsRepo(?:\?|!)?\.deleteByBatch\s*\(/g],
  ['ad metric batch/source delete', /state\.adMetricsRepo(?:\?|!)?\.deleteByBatchAndSourceFiles\s*\(/g],
  ['ad metric batch insert', /state\.adMetricsRepo(?:\?|!)?\.insertBatch\s*\(/g],
  ['ad metric insert', /state\.adMetricsRepo(?:\?|!)?\.insert\s*\(/g],
  ['ad metric range read', /state\.adMetricsRepo(?:\?|!)?\.findByDateRange\s*\(/g],
  ['ad metric summary read', /state\.adMetricsRepo(?:\?|!)?\.getSummary\s*\(/g],
  ['ad metric recommendation read', /state\.adMetricsRepo(?:\?|!)?\.findForRecommendations\s*\(/g],
  ['AI call log insert', /state\.aiCallLogRepo(?:\?|!)?\.insert\s*\(/g],
  ['AI call log recent read', /state\.aiCallLogRepo(?:\?|!)?\.findRecent\s*\(/g],
  ['AI diagnosis insert', /state\.aiDiagnosisRunRepo(?:\?|!)?\.insert\s*\(/g],
  ['AI diagnosis recent read', /state\.aiDiagnosisRunRepo(?:\?|!)?\.findRecent\s*\(/g],
  ['recommendation id read', /state\.recommendationRepo(?:\?|!)?\.findById\s*\(/g],
  ['recommendation filter read', /state\.recommendationRepo(?:\?|!)?\.findByFilter\s*\(/g],
  ['recommendation insert', /state\.recommendationRepo(?:\?|!)?\.insert\s*\(/g],
  ['recommendation duplicate insert', /state\.recommendationRepo(?:\?|!)?\.insertIfNoDuplicate\s*\(/g],
  ['recommendation duplicate read', /state\.recommendationRepo(?:\?|!)?\.findDuplicate\s*\(/g],
  ['recommendation status write', /state\.recommendationRepo(?:\?|!)?\.updateStatus\s*\(/g],
  ['recommendation evidence write', /state\.recommendationRepo(?:\?|!)?\.updateStatusWithEvidence\s*\(/g],
  ['recommendation evidence CAS', /state\.recommendationRepo(?:\?|!)?\.updateStatusWithEvidenceIfCurrent\s*\(/g],
  ['recommendation target CAS', /state\.recommendationRepo(?:\?|!)?\.bindWritableTargetIfCurrent\s*\(/g],
  ['recommendation daily count', /state\.recommendationRepo(?:\?|!)?\.countByDate\s*\(/g],
  ['recommendation daily status count', /state\.recommendationRepo(?:\?|!)?\.countByDateAndStatus\s*\(/g],
  ['recommendation daily status read', /state\.recommendationRepo(?:\?|!)?\.findByDateAndStatus\s*\(/g],
  ['action log insert', /state\.actionLogRepo(?:\?|!)?\.insert\s*\(/g],
  ['action log range read', /state\.actionLogRepo(?:\?|!)?\.findByDateRange\s*\(/g],
  ['ad metric recent read', /state\.adMetricsRepo(?:\?|!)?\.getRecent\s*\(/g],
  ['ad metric sales aggregate', /state\.adMetricsRepo(?:\?|!)?\.getTotalSales\s*\(/g],
  ['ad metric cost aggregate', /state\.adMetricsRepo(?:\?|!)?\.getTotalCost\s*\(/g],
  ['ad metric click aggregate', /state\.adMetricsRepo(?:\?|!)?\.getTotalClicks\s*\(/g],
  ['ad metric order aggregate', /state\.adMetricsRepo(?:\?|!)?\.getTotalOrders\s*\(/g],
] as const;

describe('store-scoped production wiring', () => {
  it('does not call deprecated unscoped repositories from the Main production entrypoint', () => {
    const violations = deprecatedProductionCalls.flatMap(([label, pattern]) => {
      const matches = mainSource.match(pattern) ?? [];
      return matches.map((match) => `${label}: ${match}`);
    });

    expect(violations).toEqual([]);
  });

  it('binds legacy-shaped logs and metrics IPC reads to Main-owned active store authority', () => {
    const ipcBlock = mainSource.slice(
      mainSource.indexOf('// Logs'),
      mainSource.indexOf("registerTrackedIpcHandler('v1_5:keywords:build-opportunities'"),
    );

    expect(ipcBlock).toContain('resolveBusinessStoreAuthority()');
    expect(ipcBlock).toContain('findByDateRangeForStore');
    expect(ipcBlock).toContain('getRecentForStore');
    expect(ipcBlock).toContain('getTotalSalesForStore');
    expect(ipcBlock).toContain('getTotalCostForStore');
    expect(ipcBlock).toContain('getTotalClicksForStore');
    expect(ipcBlock).toContain('getTotalOrdersForStore');
  });

  it('builds the daily report from the captured store business date and store capsule', () => {
    const dailyReportBlock = mainSource.slice(
      mainSource.indexOf('async function runDailyReportGeneration'),
      mainSource.indexOf('// IPC Handlers'),
    );

    expect(dailyReportBlock).toContain('const today = context.businessDate');
    expect(dailyReportBlock).toContain('storeCapsuleFor(store)');
    expect(dailyReportBlock).toContain('path.join(capsule.reportsDir');
    expect(dailyReportBlock).not.toContain("new Date().toISOString().split('T')[0]");
  });

  it('uses immutable store authority for metrics, approval evidence, and writable target lookup', () => {
    const businessMetricsWhere = mainSource.slice(
      mainSource.indexOf('function businessMetricsWhere('),
      mainSource.indexOf('function collectBusinessBatchScopeMismatches('),
    );

    expect(businessMetricsWhere).toContain('store_id = ?');
    expect(businessMetricsWhere).not.toContain('store_name');
    for (const source of [recommendationMetricSourceAuthority, writableAdTargetResolution]) {
      expect(source).toContain('store_id = ?');
      expect(source).not.toContain("COALESCE(store_name, '') = COALESCE(?, '')");
    }
  });
});
