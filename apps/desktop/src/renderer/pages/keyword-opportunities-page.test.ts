import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { KeywordOpportunityView } from '../types';
import {
  buildKeywordOpportunityTaskModel,
  buildKeywordOpportunityFilterFeedback,
  createKeywordOpportunityRequestGate,
  keywordOpportunityScopeKey,
  keywordOpportunityActionButtonView,
  keywordOpportunityTableFeedbackClass,
  nextKeywordOpportunitySort,
  sortKeywordOpportunities,
} from './keyword-opportunities-page';

describe('KeywordOpportunitiesPage dialog focus contracts', () => {
  it('uses independent shared focus scopes for filters and source details', () => {
    const source = readFileSync(new URL('./keyword-opportunities-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const keywordFilterDialogFocus = useOverlayFocusScope');
    expect(source).toContain('open: filterModalOpen');
    expect(source).toContain('const opportunityDetailDialogFocus = useOverlayFocusScope');
    expect(source).toContain('open: opportunityDetailOpen');
    expect(source).toContain('ref={keywordFilterDialogFocus.overlayRootRef}');
    expect(source).toContain('ref={keywordFilterDialogFocus.surfaceRef}');
    expect(source).toContain('ref={opportunityDetailDialogFocus.overlayRootRef}');
    expect(source).toContain('ref={opportunityDetailDialogFocus.surfaceRef}');
    expect(source).not.toContain('onKeyDown={handleFilterModalKeyDown}');
    expect(source).not.toContain('onKeyDown={handleOpportunityDetailKeyDown}');
  });
});

describe('keyword opportunity scope authority', () => {
  it('ignores late keyword results after the active scope changes', () => {
    const gate = createKeywordOpportunityRequestGate();
    const scopeA = keywordOpportunityScopeKey({
      dateFrom: '2026-06-01', dateTo: '2026-06-07', storeName: 'A', marketplaceCode: 'US', batchId: 'batch-a',
    });
    const scopeB = keywordOpportunityScopeKey({
      dateFrom: '2026-06-08', dateTo: '2026-06-14', storeName: 'B', marketplaceCode: 'US', batchId: 'batch-b',
    });

    gate.activate(scopeA);
    const requestA = gate.begin(scopeA);
    gate.activate(scopeB);
    const requestB = gate.begin(scopeB);

    expect(gate.isCurrent(requestA)).toBe(false);
    expect(gate.isCurrent(requestB)).toBe(true);
  });

  it('prevents cross-scope Listing handoff in the rendered page contract', () => {
    const source = readFileSync(new URL('./keyword-opportunities-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('rowsScopeKey !== requestScopeKey');
    expect(source).toContain('const authoritativeScope = rowsAuthorityScopeRef.current');
    expect(source).toContain('dateFrom: authoritativeScope.dateFrom');
    expect(source).toContain('batchId: authoritativeScope.batchId');
  });
});

describe('keyword opportunity task-first model', () => {
  it('routes missing real data to import validation without exposing Listing handoff', () => {
    expect(buildKeywordOpportunityTaskModel({
      quantReady: false,
      loading: false,
      rowCount: 0,
      selectedKeyword: '',
    })).toMatchObject({
      tone: 'blocked',
      primaryIntent: 'import-validation',
      primaryLabel: '去导入校验',
      secondaryIntents: ['data-collection'],
    });
  });

  it('makes the selected real-data opportunity the only primary handoff', () => {
    const model = buildKeywordOpportunityTaskModel({
      quantReady: true,
      loading: false,
      rowCount: 12,
      selectedKeyword: 'wide toe box',
    });

    expect(model).toMatchObject({
      tone: 'confirmed',
      primaryIntent: 'handoff-listing',
      primaryLabel: '带入 Listing',
      statusLabel: '已选 wide toe box',
    });
    expect(model.secondaryIntents).toEqual(['show-source', 'filter']);
    expect(model.secondaryIntents).toHaveLength(2);
  });
});

function row(overrides: Partial<KeywordOpportunityView>): KeywordOpportunityView {
  return {
    asin: 'B000000000',
    portfolioName: 'portfolio',
    campaignName: 'campaign',
    adGroupName: 'ad-group',
    entityType: 'keyword',
    keyword: 'keyword',
    coverageStatus: '未覆盖',
    clicks: 0,
    orders: 0,
    spend: 0,
    sales: 0,
    acos: 0,
    opportunityLevel: 'low',
    recommendedPlacement: '标题',
    risk: '无',
    ...overrides,
  };
}

describe('keyword opportunity sorting', () => {
  it('sorts opportunity rows without mutating the original result order', () => {
    const rows = [
      row({ keyword: 'low order', orders: 1, spend: 120, opportunityLevel: 'low' }),
      row({ keyword: 'top order', orders: 8, spend: 30, opportunityLevel: 'medium' }),
      row({ keyword: 'mid order', orders: 4, spend: 90, opportunityLevel: 'high' }),
    ];

    expect(sortKeywordOpportunities(rows, { key: 'orders', direction: 'desc' }).map((item) => item.keyword)).toEqual([
      'top order',
      'mid order',
      'low order',
    ]);
    expect(rows.map((item) => item.keyword)).toEqual(['low order', 'top order', 'mid order']);
  });

  it('keeps high opportunity levels first when sorting by opportunity level', () => {
    const rows = [
      row({ keyword: 'low', opportunityLevel: 'low', orders: 10 }),
      row({ keyword: 'high', opportunityLevel: 'high', orders: 1 }),
      row({ keyword: 'medium', opportunityLevel: 'medium', orders: 3 }),
    ];

    expect(sortKeywordOpportunities(rows, { key: 'opportunityLevel', direction: 'desc' }).map((item) => item.keyword)).toEqual([
      'high',
      'medium',
      'low',
    ]);
  });

  it('uses text-first ascending order for keyword headers and descending order for numeric headers', () => {
    expect(nextKeywordOpportunitySort({ key: 'orders', direction: 'desc' }, 'orders')).toEqual({ key: 'orders', direction: 'asc' });
    expect(nextKeywordOpportunitySort({ key: 'orders', direction: 'asc' }, 'keyword')).toEqual({ key: 'keyword', direction: 'asc' });
    expect(nextKeywordOpportunitySort({ key: 'keyword', direction: 'asc' }, 'spend')).toEqual({ key: 'spend', direction: 'desc' });
  });
});

describe('keyword opportunity filter micro-feedback', () => {
  it('summarizes filter and sort changes for the live feedback line', () => {
    expect(buildKeywordOpportunityFilterFeedback({
      activeFilterCount: 2,
      sortDirection: 'desc',
      sortLabel: '花费',
      totalCount: 12,
      visibleCount: 7,
    })).toBe('已应用 2 个筛选条件，按花费降序展示 7/12 个机会。');

    expect(buildKeywordOpportunityFilterFeedback({
      activeFilterCount: 0,
      sortDirection: 'desc',
      sortLabel: '机会等级',
      totalCount: 12,
      visibleCount: 12,
    })).toBe('未设置筛选条件，按机会等级降序展示 12/12 个机会。');
  });

  it('marks the table shell only while the filter transition is refreshing', () => {
    expect(keywordOpportunityTableFeedbackClass(false)).toBe('keyword-opportunity-table-shell');
    expect(keywordOpportunityTableFeedbackClass(true)).toContain('keyword-opportunity-table-refreshing');
  });

  it('keeps the 100ms vertical crossfade and aria-live source contract wired', () => {
    const source = readFileSync(new URL('./keyword-opportunities-page.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('keyword-opportunity-filter-feedback');
    expect(source).toContain('setTableRefreshing');
    expect(styles).toContain('.keyword-opportunity-table-refreshing');
    expect(styles).toContain('@keyframes keyword-opportunity-filter-refresh');
    expect(styles).toMatch(/animation:\s*keyword-opportunity-filter-refresh 100ms/);
    expect(styles).toContain('transform: translateY(4px)');
  });

  it('keeps structured filter cells inside a modal instead of the main workbench', () => {
    const source = readFileSync(new URL('./keyword-opportunities-page.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    const modalStart = source.indexOf('className="product-config-modal keyword-filter-modal"');
    const modalEnd = source.indexOf('<footer className="product-config-modal-footer">', modalStart);
    const filterMarkup = source.slice(modalStart, modalEnd);

    expect(source).toContain('filterModalOpen');
    expect(source).toContain('筛选条件');
    expect(source).not.toContain('keyword-filter-details');
    expect(source).toContain('const keywordFilterDialogFocus = useOverlayFocusScope');
    expect(source).toContain('ref={keywordFilterDialogFocus.overlayRootRef}');
    expect(source).toContain('ref={keywordFilterDialogFocus.surfaceRef}');
    expect(source).not.toContain('onKeyDown={handleFilterModalKeyDown}');
    expect(source).toContain('onClick={closeFilterModal}');
    expect(filterMarkup).toContain('<KeywordOpportunityFilterCell');
    expect(filterMarkup).not.toMatch(/<label>\s*(ASIN|Campaign|Ad Group|覆盖状态|最低点击|最低花费 USD|机会等级)/);
    expect(styles).toContain('.keyword-filter-cell');
    expect(styles).toContain('.keyword-filter-cell:focus-within');
    expect(styles).toContain('.keyword-filter-cell-hint');
    expect(styles).toContain('.keyword-filter-modal');
    expect(styles).toContain('.keyword-filter-actions');
  });
});

describe('keywordOpportunityActionButtonView', () => {
  it('gives the refresh action an explicit busy contract', () => {
    const running = keywordOpportunityActionButtonView({
      active: true,
      baseClassName: 'secondary-button',
      busyLabel: '刷新中...',
      label: '刷新机会',
    });

    expect(running.label).toBe('刷新中...');
    expect(running.className).toContain('secondary-button');
    expect(running.className).toContain('button-loading');
    expect(running.disabled).toBe(true);
    expect(running.ariaBusy).toBe(true);
    expect(running.showSpinner).toBe(true);
  });

  it('locks peer keyword actions without making them look active', () => {
    const locked = keywordOpportunityActionButtonView({
      active: false,
      baseClassName: 'secondary-button',
      busyLabel: '刷新中...',
      groupBusy: true,
      label: '进入 Listing',
    });

    expect(locked.label).toBe('进入 Listing');
    expect(locked.disabled).toBe(true);
    expect(locked.ariaBusy).toBeUndefined();
    expect(locked.className).not.toContain('button-loading');
    expect(locked.showSpinner).toBe(false);
  });
});

describe('Phase 5 keyword opportunity user task surface', () => {
  it('frames keyword opportunities as a table-first Listing handoff workbench with evidence folded', () => {
    const source = readFileSync(new URL('./keyword-opportunities-page.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('复核可带入 Listing 的关键词机会');
    expect(source).toContain('关键词机会池');
    expect(source).toContain('keyword-opportunity-summary-grid');
    expect(source).toContain('keyword-opportunity-blocker-strip');
    expect(source).toContain('报表文件 {sourceReportCount}/8 · 逐类入库 {importedReportTypeCount}/8 · {importedMetricRows} 行');
    expect(source).not.toContain('KpiCard');
    expect(source).toContain('selectedRowKey={selectedOpportunityKey}');
    expect(source).toContain('onRowSelect={(row) => setSelectedOpportunityKey(rowKey(row))}');
    expect(source).toContain('keyword-opportunity-selection-bar');
    expect(source).toContain('keyword-opportunity-detail-modal');
    expect(source).not.toContain('keyword-opportunity-selected-summary');
    expect(source).not.toContain('查看处理');
    expect(source).not.toContain('收起处理');
    expect(source).toContain('机会口径、来源和复核摘要');
    expect(source).toContain('<ProgressiveDetails title="机会口径、来源和复核摘要"');
    expect(source).not.toContain('<details className="folded-ops-panel"');
    expect(source).toContain('审计文件、截图和 DOM 证据不算广告数据');
    expect(styles).toContain('.keyword-opportunity-page-stack .virtual-table-row-selected');
    expect(styles).toContain('inset 4px 0 0 var(--color-accent)');
  });

  it('uses one TaskBanner and one unnested technical disclosure', () => {
    const source = readFileSync(new URL('./keyword-opportunities-page.tsx', import.meta.url), 'utf8');
    const technicalStart = source.indexOf('<ProgressiveDetails title="机会口径、来源和复核摘要"');
    const technicalEnd = source.indexOf('</ProgressiveDetails>', technicalStart);

    expect(source.match(/<TaskBanner\b/g) || []).toHaveLength(1);
    expect(technicalStart).toBeGreaterThan(-1);
    expect(technicalEnd).toBeGreaterThan(technicalStart);
    expect(source.slice(technicalStart, technicalEnd)).not.toMatch(/<details\b/);
  });
});
