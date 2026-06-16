import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  adMetricCanonicalWhere,
  adMetricGrainWhere,
  adMetricReportTypesWhere,
  chooseCanonicalAdMetricReportTypes,
  inferAdMetricReportType,
  isActionableReportType,
  isBreakdownReportType,
} from './ad-metric-grain';

function createReportTypeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE metrics (
      report_type TEXT,
      source_file TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO metrics (report_type, source_file) VALUES (?, ?)');
  for (const row of [
    ['campaign', 'campaign.xlsx'],
    ['ad_group', 'ad_group.xlsx'],
    ['placement', 'placement.xlsx'],
    ['advertised_product', 'advertised_product.xlsx'],
    ['keyword', 'keyword.xlsx'],
    ['product_targeting', 'product-targeting.xlsx'],
    ['auto_targeting', 'auto-targeting.xlsx'],
    ['user_search_term', 'user-search-term.xlsx'],
    ['search_term', 'search-term.xlsx'],
    [null, 'legacy-keyword-report.xlsx'],
    [null, 'legacy-campaign-report.xlsx'],
  ] as Array<[string | null, string]>) {
    insert.run(row[0], row[1]);
  }
  return db;
}

describe('ad metric report grain helpers', () => {
  it('separates actionable rows from duplicate breakdown reports', () => {
    const db = createReportTypeDb();
    try {
      const rows = db.prepare(`
        SELECT COALESCE(report_type, source_file) AS value
        FROM metrics
        WHERE ${adMetricGrainWhere('actionable')}
        ORDER BY value
      `).all() as Array<{ value: string }>;

      expect(rows.map((row) => row.value)).toEqual([
        'auto_targeting',
        'keyword',
        'legacy-keyword-report.xlsx',
        'product_targeting',
        'search_term',
        'user_search_term',
      ]);
    } finally {
      db.close();
    }
  });

  it('separates breakdown rows for drilldown without treating them as actionable totals', () => {
    const db = createReportTypeDb();
    try {
      const rows = db.prepare(`
        SELECT COALESCE(report_type, source_file) AS value
        FROM metrics
        WHERE ${adMetricGrainWhere('breakdown')}
        ORDER BY value
      `).all() as Array<{ value: string }>;

      expect(rows.map((row) => row.value)).toEqual([
        'ad_group',
        'advertised_product',
        'campaign',
        'legacy-campaign-report.xlsx',
        'placement',
      ]);
    } finally {
      db.close();
    }
  });

  it('does not filter imported row completeness when grain is all', () => {
    const db = createReportTypeDb();
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM metrics
        WHERE ${adMetricGrainWhere('all')}
      `).get() as { count: number };

      expect(row.count).toBe(11);
    } finally {
      db.close();
    }
  });

  it('chooses one canonical report type for authoritative totals before using approximate fallback', () => {
    expect(chooseCanonicalAdMetricReportTypes(['campaign', 'keyword', 'user_search_term'])).toEqual({
      reportTypes: ['user_search_term'],
      summarySource: 'canonical_user_search_term',
      isApproximate: false,
    });
    expect(chooseCanonicalAdMetricReportTypes(['campaign', 'keyword', 'search_term']).reportTypes).toEqual(['search_term']);
    expect(chooseCanonicalAdMetricReportTypes(['campaign', 'keyword', 'product_targeting'])).toMatchObject({
      reportTypes: ['keyword', 'product_targeting'],
      summarySource: 'actionable_fallback',
      isApproximate: true,
    });
    expect(chooseCanonicalAdMetricReportTypes(['campaign', 'ad_group'])).toMatchObject({
      reportTypes: [],
      summarySource: 'none',
      isApproximate: false,
    });
  });

  it('builds a scoped clause for explicitly selected canonical report types', () => {
    const db = createReportTypeDb();
    try {
      const row = db.prepare(`
        SELECT COUNT(*) AS count
        FROM metrics
        WHERE ${adMetricReportTypesWhere(['search_term'])}
      `).get() as { count: number };

      expect(row.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it('builds canonical where clauses from available report types without mixing breakdown grains', () => {
    const db = createReportTypeDb();
    try {
      const canonical = adMetricCanonicalWhere(['campaign', 'ad_group', 'keyword', 'user_search_term']);
      expect(canonical.selection).toEqual({
        reportTypes: ['user_search_term'],
        summarySource: 'canonical_user_search_term',
        isApproximate: false,
      });

      const rows = db.prepare(`
        SELECT COALESCE(report_type, source_file) AS value
        FROM metrics
        WHERE ${canonical.whereSql}
        ORDER BY value
      `).all() as Array<{ value: string }>;

      expect(rows.map((row) => row.value)).toEqual(['user_search_term']);
    } finally {
      db.close();
    }
  });

  it('classifies known report types', () => {
    expect(isActionableReportType('keyword')).toBe(true);
    expect(isActionableReportType('campaign')).toBe(false);
    expect(isBreakdownReportType('campaign')).toBe(true);
    expect(isBreakdownReportType('search_term')).toBe(false);
    expect(inferAdMetricReportType('', 'download/User Search Term Report.xlsx')).toBe('user_search_term');
    expect(inferAdMetricReportType(null, 'download/product targeting report.xlsx')).toBe('product_targeting');
    expect(inferAdMetricReportType('keyword', 'campaign.xlsx')).toBe('keyword');
  });
});
