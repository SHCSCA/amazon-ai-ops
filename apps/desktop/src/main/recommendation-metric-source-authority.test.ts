import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRecommendationMetricSourceAuthority } from './recommendation-metric-source-authority';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function createFixture(reportType = 'keyword', fileName = '01_关键词报表_202607.xlsx') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-source-authority-'));
  tempDirs.push(dir);
  const sourceFile = path.join(dir, fileName);
  fs.writeFileSync(sourceFile, 'report');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ad_daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT,
      report_type TEXT,
      date TEXT,
      store_name TEXT,
      marketplace_code TEXT,
      asin TEXT,
      campaign_name TEXT,
      ad_group_name TEXT,
      targeting TEXT,
      search_term TEXT,
      source_file TEXT,
      source_row INTEGER
    );
  `);
  db.prepare(`
    INSERT INTO ad_daily_metrics (
      batch_id, report_type, date, store_name, marketplace_code, asin,
      campaign_name, ad_group_name, targeting, search_term, source_file, source_row
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'batch_current', reportType, '2026-06-23', 'FT-US-US', 'US', 'B0TESTASIN',
    'Campaign A', 'Ad Group A', 'door lock', 'customer query', sourceFile, 611,
  );
  const scope = {
    dateFrom: '2026-05-21',
    dateTo: '2026-06-23',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B0TESTASIN',
    batchId: 'batch_current',
  };
  const recommendation: ActionRecommendation = {
    id: 81,
    taskId: 'task_81',
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    msku: 'MSKU-81',
    entityType: 'target',
    entityId: 'synthetic-target-81',
    entityName: 'door lock',
    actionType: 'lower_bid',
    currentValue: '1.49',
    recommendedValue: '1.00',
    reason: 'Bounded bid reduction.',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 40,
      orders: 2,
      sales: 70,
      acos: 0.57,
      cpc: 1.33,
      cvr: 0.06,
      date: '2026-06-23',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      targeting: 'door lock',
      batchId: scope.batchId,
      reportType,
      sourceFile,
      sourceFiles: [sourceFile],
      sourceRow: 611,
    },
    confidence: 0.88,
    riskLevel: 'APPROVAL',
    status: 'pending',
  };
  return { db, recommendation, scope, sourceFile };
}

describe('recommendation metric source authority', () => {
  it.each([
    ['keyword', '01_关键词报表_202607.xlsx'],
    ['auto_targeting', '2026-07-auto-targeting-export.xlsx'],
    ['product_targeting', '03_商品投放报告.xlsx'],
  ])('uses DB report_type instead of the %s report basename', (reportType, fileName) => {
    const fixture = createFixture(reportType, fileName);
    try {
      expect(assertRecommendationMetricSourceAuthority(fixture.db, {
        recommendation: fixture.recommendation,
        scope: fixture.scope,
        allowedSourceFiles: [fixture.sourceFile],
      })).toMatchObject({
        reportType,
        entityName: 'door lock',
        sourceFile: fixture.sourceFile,
        sourceRow: 611,
      });
    } finally {
      fixture.db.close();
    }
  });

  it.each([
    ['batch', { batchId: 'batch_other' }],
    ['store', { storeName: 'OTHER-US' }],
    ['marketplace', { marketplaceCode: 'CA' }],
    ['asin', { asin: 'B0OTHERASIN' }],
    ['date', { dateTo: '2026-06-22' }],
  ])('fails closed when the locked %s scope cannot resolve the source row', (_label, scopePatch) => {
    const fixture = createFixture();
    try {
      expect(() => assertRecommendationMetricSourceAuthority(fixture.db, {
        recommendation: fixture.recommendation,
        scope: { ...fixture.scope, ...scopePatch },
        allowedSourceFiles: [fixture.sourceFile],
      })).toThrow(/来源权威核验被阻断/);
    } finally {
      fixture.db.close();
    }
  });

  it('rejects a recommendation report type snapshot that differs from the DB row', () => {
    const fixture = createFixture('keyword');
    try {
      fixture.recommendation.evidence.reportType = 'product_targeting';
      expect(() => assertRecommendationMetricSourceAuthority(fixture.db, {
        recommendation: fixture.recommendation,
        scope: fixture.scope,
        allowedSourceFiles: [fixture.sourceFile],
      })).toThrow(/来源报表类型.*数据库权威行不一致/);
    } finally {
      fixture.db.close();
    }
  });

  it('blocks search-term source rows until a dedicated writable-target mapping exists', () => {
    const fixture = createFixture('user_search_term', '01_用户搜索词报告.xlsx');
    try {
      expect(() => assertRecommendationMetricSourceAuthority(fixture.db, {
        recommendation: fixture.recommendation,
        scope: fixture.scope,
        allowedSourceFiles: [fixture.sourceFile],
      })).toThrow(/不能直接授权首个降低竞价动作/);
    } finally {
      fixture.db.close();
    }
  });

  it('rejects a legacy sourceFiles plus sourceRow pair when two allowed files match', () => {
    const fixture = createFixture();
    const secondFile = path.join(path.dirname(fixture.sourceFile), '02_keyword.xlsx');
    fs.writeFileSync(secondFile, 'second report');
    fixture.db.prepare(`
      INSERT INTO ad_daily_metrics (
        batch_id, report_type, date, store_name, marketplace_code, asin,
        campaign_name, ad_group_name, targeting, search_term, source_file, source_row
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'batch_current', 'keyword', '2026-06-23', 'FT-US-US', 'US', 'B0TESTASIN',
      'Campaign A', 'Ad Group A', 'door lock', '', secondFile, 611,
    );
    delete fixture.recommendation.evidence.sourceFile;
    fixture.recommendation.evidence.sourceFiles = [fixture.sourceFile, secondFile];
    try {
      expect(() => assertRecommendationMetricSourceAuthority(fixture.db, {
        recommendation: fixture.recommendation,
        scope: fixture.scope,
        allowedSourceFiles: [fixture.sourceFile, secondFile],
      })).toThrow(/实际命中 2 条/);
    } finally {
      fixture.db.close();
    }
  });
});
